package session

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Channel = ama.JSONChannel
type AssignmentHandler func(context.Context, *ama.Lease, *ama.WorkItem)

// Opener dials the per-runner relay channel
// (GET /api/v1/runners/{runnerId}/channel).
type Opener interface {
	Channel(ctx context.Context, runnerID string) (Channel, error)
}

// Relay owns the runner's single persistent relay channel and multiplexes every
// CLI session it hosts over it — the per-runner replacement for the per-lease
// channel. One connection, reconnecting on drop, that outlives any single lease so
// a completed session still reads while the runner is online ("runner online ⇒
// available"). The relay is the SINGLE reader of the socket: it demuxes inbound
// messages by sessionId (a session.command → that session's live
// handle; a session.backfill_request → answered from the session's on-disk
// log, which survives the lease). Outbound, a session relays each stored event live
// and fire-and-forget — the event is already durable on disk (the cloud keeps no
// copy), so a momentary disconnect drops only the live fan, never the run.
type Relay struct {
	opener   Opener
	runnerID string
	assign   AssignmentHandler
	// storeDir is {WorkDir}/sessions; a session's log is storeDir/{sessionId}/events.jsonl.
	storeDir string

	// mu guards sessions. The map intentionally survives reconnect cycles: a session
	// registered before a socket drop keeps receiving commands once the channel
	// re-establishes, so a transient blip never loses command routing.
	mu                    sync.Mutex
	sessions              map[string]Handle
	deliveredCommandKeys  map[string][sha256.Size]byte
	deliveredCommandOrder []string

	// writeMu guards conn AND serialises every write (relay events + backfill
	// responses), so the conn check and the write are atomic — a concurrent
	// reconnect cannot null the socket mid-write.
	writeMu sync.Mutex
	conn    Channel
}

type RelayStamp struct {
	Sequence  int64
	ID        string
	CreatedAt string
}

func NewRelay(opener Opener, runnerID string, workDir string, assignmentHandlers ...AssignmentHandler) *Relay {
	var assign AssignmentHandler
	if len(assignmentHandlers) > 0 {
		assign = assignmentHandlers[0]
	}
	return &Relay{
		opener:               opener,
		runnerID:             runnerID,
		assign:               assign,
		storeDir:             filepath.Join(workDir, workspace.SessionsDirName),
		sessions:             map[string]Handle{},
		deliveredCommandKeys: map[string][sha256.Size]byte{},
	}
}

const relayReconnectDelay = 3 * time.Second
const deliveredCommandHistoryLimit = 1024

// run maintains the channel for the runner's lifetime: dial, handshake, read until
// the socket drops, then reconnect after a short delay. A live event written while
// disconnected is dropped from the live fan (it is still on disk; the browser gets
// it on the next backfill), so a blip degrades to "history only", never a failure.
func (h *Relay) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		if err := h.connectAndServe(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("runner relay channel dropped; reconnecting", "runnerId", h.runnerID, "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(relayReconnectDelay):
		}
	}
}

func (h *Relay) connectAndServe(ctx context.Context) error {
	conn, err := h.opener.Channel(ctx, h.runnerID)
	if err != nil {
		return err
	}
	defer conn.Close(1000, "runner relay channel closed")
	if err := h.waitForChannelAccepted(ctx, conn); err != nil {
		return err
	}
	slog.Info("runner relay channel connected", "runnerId", h.runnerID)
	h.setConn(conn)
	defer h.clearConn()
	return h.readLoop(ctx, conn)
}

func (h *Relay) waitForChannelAccepted(ctx context.Context, conn Channel) error {
	for {
		var message protocol.RunnerChannelMessage
		if err := conn.ReadJSON(ctx, &message); err != nil {
			return err
		}
		if message.Type == "runner.channel.accepted" {
			return nil
		}
	}
}

func (h *Relay) setConn(conn Channel) {
	h.writeMu.Lock()
	h.conn = conn
	h.writeMu.Unlock()
}

func (h *Relay) clearConn() {
	h.writeMu.Lock()
	h.conn = nil
	h.writeMu.Unlock()
}

func (h *Relay) readLoop(ctx context.Context, conn Channel) error {
	for {
		var raw json.RawMessage
		if err := conn.ReadJSON(ctx, &raw); err != nil {
			return err
		}
		var message protocol.RunnerChannelMessage
		if err := json.Unmarshal(raw, &message); err != nil {
			slog.Warn("runner relay message is not an object; dropping", "error", err)
			continue
		}
		switch message.Type {
		case "work.assigned":
			h.handleWorkAssigned(ctx, raw)
		case "session.backfill_request":
			h.handleBackfillRequest(ctx, conn, message)
		case "session.command":
			h.routeCommand(ctx, conn, message)
		case "sandbox.request":
			h.handleSandboxRequest(ctx, conn, message)
		default:
			// runner.event.accepted / session.channel.error are advisory here: events
			// are fire-and-forget; runner.channel.accepted is the handshake, already seen.
		}
	}
}

func (h *Relay) handleWorkAssigned(ctx context.Context, raw json.RawMessage) {
	if h.assign == nil {
		return
	}
	var frame struct {
		Lease    ama.Lease    `json:"lease"`
		WorkItem ama.WorkItem `json:"workItem"`
	}
	if err := json.Unmarshal(raw, &frame); err != nil {
		slog.Warn("runner relay work assignment is invalid; dropping", "error", err)
		return
	}
	if frame.Lease.Id == "" || frame.WorkItem.Id == "" {
		slog.Warn("runner relay work assignment is missing lease or work item")
		return
	}
	h.assign(ctx, &frame.Lease, &frame.WorkItem)
}

func (h *Relay) handleSandboxRequest(ctx context.Context, conn Channel, message protocol.RunnerChannelMessage) {
	sessionID := protocol.MessageSessionID(message)
	request := protocol.MessageSandboxRequest(message)
	response := ama.JSON{
		"type":      "sandbox.response",
		"requestId": protocol.MessageRequestID(message),
		"sessionId": sessionID,
		"runnerId":  h.runnerID,
	}
	h.mu.Lock()
	router := h.sessions[sessionID]
	h.mu.Unlock()
	if router == nil {
		response["ok"] = false
		response["error"] = "runner sandbox session is not active"
	} else {
		sandboxHandler, ok := router.(SandboxHandler)
		if !ok {
			response["ok"] = false
			response["error"] = "runner session does not accept sandbox requests"
			h.writeResponse(ctx, conn, response, "runner failed to write sandbox response", sessionID)
			return
		}
		result, err := sandboxHandler.ExecuteSandbox(ctx, request)
		if err != nil {
			response["ok"] = false
			response["error"] = err.Error()
		} else {
			response["ok"] = true
			response["result"] = result
		}
	}
	h.writeResponse(ctx, conn, response, "runner failed to write sandbox response", sessionID)
}

func (h *Relay) routeCommand(ctx context.Context, conn Channel, message protocol.RunnerChannelMessage) {
	sessionID := protocol.MessageSessionID(message)
	requestID := protocol.MessageRequestID(message)
	command := protocol.MessageCommand(message)
	if sessionID == "" {
		return
	}
	respond := func(accepted bool) {
		if requestID == "" {
			return
		}
		response := ama.JSON{
			"type":      "session.command.result",
			"requestId": requestID,
			"sessionId": sessionID,
			"runnerId":  h.runnerID,
			"accepted":  accepted,
		}
		h.writeResponse(ctx, conn, response, "runner failed to write command acknowledgement", sessionID)
	}
	commandKey := sessionID + "\x00" + requestID
	if requestID != "" {
		if seen, matches := h.commandDelivery(commandKey, command); seen {
			respond(matches)
			return
		}
	}
	h.mu.Lock()
	router := h.sessions[sessionID]
	h.mu.Unlock()
	if router == nil {
		// The session is not live on this runner (completed, or never ran here), so a
		// command for it cannot be delivered to a runtime handle.
		slog.Info("runner relay command for an inactive session; dropping",
			"sessionId", sessionID)
		respond(false)
		return
	}
	commandHandler, ok := router.(CommandHandler)
	if !ok {
		slog.Info("runner relay command for session without command handler; dropping",
			"sessionId", sessionID)
		respond(false)
		return
	}
	deliver := commandHandler.DeliverCommand
	if requestID != "" {
		acknowledgedHandler, supportsAcknowledgement := router.(AcknowledgedCommandHandler)
		if !supportsAcknowledgement {
			respond(false)
			return
		}
		deliver = acknowledgedHandler.DeliverAcknowledgedCommand
	}
	if err := deliver(command); err != nil {
		h.recordRuntimeErrorEvent(sessionID, "Runner failed to forward live prompt to runtime bridge: "+err.Error(), "runtime_prompt_delivery_failed")
		respond(false)
		return
	}
	if requestID != "" {
		h.rememberDeliveredCommand(commandKey, command)
	}
	if prompt, ok := livePromptMessage(command); ok {
		h.recordLivePromptEvent(sessionID, prompt)
	}
	respond(true)
}

func (h *Relay) commandDelivery(key string, command protocol.RunnerSessionCommand) (bool, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	digest, ok := h.deliveredCommandKeys[key]
	return ok, !ok || digest == sha256.Sum256(command)
}

func (h *Relay) rememberDeliveredCommand(key string, command protocol.RunnerSessionCommand) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, exists := h.deliveredCommandKeys[key]; exists {
		return
	}
	h.deliveredCommandKeys[key] = sha256.Sum256(command)
	h.deliveredCommandOrder = append(h.deliveredCommandOrder, key)
	if len(h.deliveredCommandOrder) <= deliveredCommandHistoryLimit {
		return
	}
	oldest := h.deliveredCommandOrder[0]
	h.deliveredCommandOrder = h.deliveredCommandOrder[1:]
	delete(h.deliveredCommandKeys, oldest)
}

func livePromptMessage(command protocol.RunnerSessionCommand) (string, bool) {
	var frame struct {
		Type    string  `json:"type"`
		Message *string `json:"message"`
	}
	if err := json.Unmarshal(command, &frame); err != nil {
		return "", false
	}
	if frame.Type != "send" || frame.Message == nil {
		return "", false
	}
	return *frame.Message, true
}

func livePromptPayload(message string) (ama.JSON, error) {
	id, err := newEventID()
	if err != nil {
		return nil, err
	}
	return ama.JSON{
		"message": ama.JSON{
			"id":   "msg_" + strings.TrimPrefix(id, "event_"),
			"role": "user",
			"content": []ama.JSON{
				{"type": "text", "text": message},
			},
		},
	}, nil
}

func (h *Relay) recordLivePromptEvent(sessionID string, message string) {
	h.recordStoredEvent(sessionID, ama.JSON{"type": "message.completed", "payload": mustLivePromptPayload(message)})
}

func mustLivePromptPayload(message string) ama.JSON {
	payload, err := livePromptPayload(message)
	if err != nil {
		return ama.JSON{
			"message": ama.JSON{
				"id":   "msg_live_prompt_unavailable",
				"role": "user",
				"content": []ama.JSON{
					{"type": "text", "text": message},
				},
			},
		}
	}
	return payload
}

func (h *Relay) recordRuntimeErrorEvent(sessionID string, message string, code string) {
	h.recordStoredEvent(sessionID, ama.JSON{
		"type": "runtime.error",
		"payload": ama.JSON{
			"message": message,
			"code":    code,
		},
	})
}

func (h *Relay) recordStoredEvent(sessionID string, event ama.JSON) {
	store, err := OpenEventLog(filepath.Join(h.storeDir, sessionID), sessionID)
	if err != nil {
		slog.Warn("runner failed to open session event log for live command", "sessionId", sessionID, "error", err)
		return
	}
	stored, err := store.Append(event)
	if err != nil {
		slog.Warn("runner failed to record live command event", "sessionId", sessionID, "error", err)
		return
	}
	h.RelayEvent(context.Background(), sessionID, stored.AmaEvent(), &RelayStamp{
		Sequence:  stored.Sequence,
		ID:        stored.ID,
		CreatedAt: stored.CreatedAt,
	})
}

// handleBackfillRequest answers a relayed history read for one session straight from
// its on-disk log, so a completed session (no live router) still serves its whole
// transcript while the runner is online. The server canonicalises, threads, filters,
// and paginates; the runner's contract is "the whole log for that session".
func (h *Relay) handleBackfillRequest(ctx context.Context, conn Channel, message protocol.RunnerChannelMessage) {
	sessionID := protocol.MessageSessionID(message)
	response := ama.JSON{
		"type":      "session.backfill_response",
		"eventId":   protocol.MessageEventID(message),
		"sessionId": sessionID,
		"events":    []Event{},
	}
	if sessionID != "" {
		events, err := ReadEventLog(EventLogPath(filepath.Join(h.storeDir, sessionID)))
		if err != nil {
			response["error"] = err.Error()
		} else if events != nil {
			response["events"] = events
		}
	}
	h.writeMu.Lock()
	err := conn.WriteJSON(ctx, response)
	h.writeMu.Unlock()
	if err != nil {
		slog.Warn("runner failed to write relay backfill response", "sessionId", sessionID, "error", err)
	}
}

func (h *Relay) writeResponse(ctx context.Context, conn Channel, response ama.JSON, message string, sessionID string) {
	h.writeMu.Lock()
	err := conn.WriteJSON(ctx, response)
	h.writeMu.Unlock()
	if err != nil {
		slog.Warn(message, "sessionId", sessionID, "error", err)
	}
}

// register marks a session live so the hub routes its commands; unregister on end.
// Backfill does not need registration (it reads the disk log), so a completed
// session keeps serving its history after it unregisters.
func (h *Relay) Register(sessionID string, handle Handle) {
	h.mu.Lock()
	h.sessions[sessionID] = handle
	h.mu.Unlock()
}

func (h *Relay) Unregister(sessionID string) {
	h.mu.Lock()
	handle := h.sessions[sessionID]
	delete(h.sessions, sessionID)
	h.mu.Unlock()
	if handle != nil {
		if err := handle.Close(context.Background()); err != nil {
			slog.Warn("runner failed to clean up sandbox workspace", "sessionId", sessionID, "error", err)
		}
	}
}

// RelayEvent dispatches one stored event live to the cloud, fire-and-forget: the
// event is already durable on disk (the cloud keeps no copy), so a momentary
// disconnect drops only the live fan, never the run. The stored id/sequence/time
// ride along so the cloud fans it with the same identity the runner backfill
// serves (the browser dedups by them).
func (h *Relay) RelayEvent(ctx context.Context, sessionID string, event ama.JSON, relay *RelayStamp) {
	recordID, err := newEventID()
	if err != nil {
		slog.Warn("runner failed to create relay event id", "sessionId", sessionID, "error", err)
		return
	}
	record := ama.JSON{
		"id":        recordID,
		"sessionId": sessionID,
		"sequence":  time.Now().UnixMilli(),
		"createdAt": time.Now().UTC().Format(time.RFC3339Nano),
		"type":      event["type"],
		"payload":   event["payload"],
	}
	if relay != nil {
		record["id"] = relay.ID
		record["sequence"] = relay.Sequence
		record["createdAt"] = relay.CreatedAt
	}
	message := ama.JSON{
		"type":      "runner.event",
		"sessionId": sessionID,
		"record":    record,
	}
	// Hold writeMu across the conn check and the write so a concurrent reconnect
	// cannot null the socket mid-write. A nil conn (disconnected) drops the live fan
	// — the event is durable on disk and reaches the browser on the next backfill.
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	if h.conn == nil {
		return
	}
	if err := h.conn.WriteJSON(ctx, message); err != nil {
		slog.Warn("runner failed to relay event live", "sessionId", sessionID, "error", err)
	}
}

func (h *Relay) NotifyWorkFinished(ctx context.Context, sessionID string, leaseID string, state string) {
	frameType := "work.completed"
	switch state {
	case "failed":
		frameType = "work.failed"
	case "cancelled":
		frameType = "work.cancelled"
	}
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	if h.conn == nil {
		return
	}
	if err := h.conn.WriteJSON(ctx, ama.JSON{
		"type":      frameType,
		"sessionId": sessionID,
		"leaseId":   leaseID,
	}); err != nil {
		slog.Warn("runner failed to notify work completion", "sessionId", sessionID, "leaseId", leaseID, "error", err)
	}
}
