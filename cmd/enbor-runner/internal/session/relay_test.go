package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/protocol"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/runtime"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sandbox"
	enbor "github.com/realmroot/enbor/sdk/go/enbor"
)

// fakeOpener is a simple Opener that returns a pre-created channel.
type fakeOpener struct {
	channel *fakeChannel
	err     error
}

func (f *fakeOpener) Channel(_ context.Context, _ string) (Channel, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.channel, nil
}

type fakeChannel struct {
	mu      sync.Mutex
	reads   chan any
	writes  []enbor.JSON
	closed  bool
	autoAck bool
}

type failFirstWriteChannel struct {
	*fakeChannel
	failed bool
}

func (ch *failFirstWriteChannel) WriteJSON(ctx context.Context, value any) error {
	if !ch.failed {
		ch.failed = true
		return errors.New("acknowledgement lost")
	}
	return ch.fakeChannel.WriteJSON(ctx, value)
}

func newFakeChannel(reads ...any) *fakeChannel {
	channel := &fakeChannel{reads: make(chan any, 16), autoAck: true}
	for _, read := range reads {
		channel.reads <- read
	}
	return channel
}

func (ch *fakeChannel) ReadJSON(ctx context.Context, out any) error {
	select {
	case value := <-ch.reads:
		if err, ok := value.(error); ok {
			return err
		}
		data, err := json.Marshal(value)
		if err != nil {
			return err
		}
		return json.Unmarshal(data, out)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (ch *fakeChannel) WriteJSON(_ context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded enbor.JSON
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	ch.mu.Lock()
	ch.writes = append(ch.writes, decoded)
	ch.mu.Unlock()
	if decoded["type"] == "runner.event" && ch.autoAck {
		record, _ := decoded["record"].(map[string]any)
		if eventID, ok := record["id"].(string); ok && eventID != "" {
			ch.reads <- enbor.JSON{"type": "runner.event.accepted", "eventId": eventID}
		}
	}
	return nil
}

func (ch *fakeChannel) Close(int, string) error {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.closed = true
	return nil
}

type closeCountingHandle struct {
	calls int
	err   error
}

func (h *closeCountingHandle) Close(context.Context) error {
	h.calls += 1
	return h.err
}

type sandboxRequestHandle struct {
	calls  int
	result enbor.JSON
	err    error
}

func (h *sandboxRequestHandle) Close(context.Context) error { return nil }

func (h *sandboxRequestHandle) ExecuteSandbox(context.Context, protocol.RunnerSandboxRequest) (enbor.JSON, error) {
	h.calls += 1
	return h.result, h.err
}

func TestRelayEventDropsWhenNotConnected(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	// conn is nil; relayEvent must not panic and must return without writing
	hub.RelayEvent(context.Background(), "session_1", enbor.JSON{"type": "message.completed", "payload": enbor.JSON{"text": "hi"}}, nil)
	// No assertions needed beyond "did not panic"
}

func TestRelayEventWritesSessionTaggedFrame(t *testing.T) {
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", t.TempDir())
	hub.setConn(ch)

	hub.RelayEvent(context.Background(), "session_42", enbor.JSON{"type": "message.completed", "payload": enbor.JSON{"text": "ok"}}, &RelayStamp{
		Sequence:  7,
		ID:        "evt-7",
		CreatedAt: "2026-01-01T00:00:07Z",
	})

	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 {
		t.Fatalf("expected 1 write, got %d", len(ch.writes))
	}
	msg := ch.writes[0]
	if msg["type"] != "runner.event" {
		t.Fatalf("expected runner.event frame, got %v", msg["type"])
	}
	if msg["sessionId"] != "session_42" {
		t.Fatalf("expected sessionId session_42, got %v", msg["sessionId"])
	}
	record, _ := msg["record"].(map[string]any)
	if record == nil {
		t.Fatal("expected record field in frame")
	}
	if record["sequence"] != float64(7) {
		t.Fatalf("expected record sequence 7, got %v", record["sequence"])
	}
	if record["id"] != "evt-7" {
		t.Fatalf("expected record id evt-7, got %v", record["id"])
	}
	if record["type"] != "message.completed" {
		t.Fatalf("expected event type message.completed, got %v", record["type"])
	}
}

func TestRelayRoutesCommandToRegisteredSession(t *testing.T) {
	workDir := t.TempDir()
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
		if err != nil {
			t.Fatalf("read prompt log during delivery: %v", err)
		}
		if len(events) != 0 {
			t.Fatalf("prompt was recorded before bridge delivery succeeded: %#v", events)
		}
		received = string(command)
		return nil
	})

	hub.routeCommand(context.Background(), ch, protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_1"),
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"build it"}`),
	})

	if received != `{"type":"send","message":"build it"}` {
		t.Fatalf("expected opaque command routed to session, got %q", received)
	}
	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("read live prompt event: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected live prompt event recorded, got %d", len(events))
	}
	message, _ := events[0].Payload["message"].(map[string]any)
	if message["role"] != "user" {
		t.Fatalf("expected user message payload, got %#v", events[0].Payload)
	}
	content, _ := message["content"].([]any)
	block, _ := content[0].(map[string]any)
	if block["text"] != "build it" {
		t.Fatalf("expected live prompt text recorded, got %#v", block)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 || ch.writes[0]["type"] != "session.command.result" || ch.writes[0]["requestId"] != "command_1" || ch.writes[0]["accepted"] != true {
		t.Fatalf("expected accepted command acknowledgement, got %#v", ch.writes)
	}
}

func TestRelayAcknowledgesRetriedDeliveredCommandWithoutDuplicateDeliveryOrPrompt(t *testing.T) {
	workDir := t.TempDir()
	ch := &failFirstWriteChannel{fakeChannel: newFakeChannel()}
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var deliveries int
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		deliveries += 1
		return nil
	})
	message := protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_retry_1"),
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"build it once"}`),
	}

	hub.routeCommand(context.Background(), ch, message)
	hub.routeCommand(context.Background(), ch, message)

	if deliveries != 1 {
		t.Fatalf("expected one bridge delivery across an acknowledgement retry, got %d", deliveries)
	}
	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("read prompt log: %v", err)
	}
	if len(events) != 1 || events[0].Type != "message.completed" {
		t.Fatalf("expected one recorded prompt across the retry, got %#v", events)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 || ch.writes[0]["requestId"] != "command_retry_1" || ch.writes[0]["accepted"] != true {
		t.Fatalf("expected the retried command to receive an accepted acknowledgement, got %#v", ch.writes)
	}
}

func TestRelayRejectsRequestIDReuseWithDifferentCommandContent(t *testing.T) {
	workDir := t.TempDir()
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var deliveries int
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		deliveries += 1
		return nil
	})
	first := protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_reused"),
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"first content"}`),
	}
	second := first
	second.Command = protocol.RunnerSessionCommand(`{"type":"send","message":"different content"}`)

	hub.routeCommand(context.Background(), ch, first)
	hub.routeCommand(context.Background(), ch, second)

	if deliveries != 1 {
		t.Fatalf("expected reused request id with different content not to reach the bridge, got %d deliveries", deliveries)
	}
	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("read prompt log: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected only the original prompt to be recorded, got %#v", events)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 2 || ch.writes[0]["accepted"] != true || ch.writes[1]["accepted"] != false {
		t.Fatalf("expected accepted original and rejected conflicting reuse, got %#v", ch.writes)
	}
}

func TestRelayRecordsRuntimeErrorWhenLivePromptForwardFails(t *testing.T) {
	workDir := t.TempDir()
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		return errors.New("stdin closed")
	})

	hub.routeCommand(context.Background(), ch, protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_failed"),
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"build it"}`),
	})

	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("read live prompt events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected only runtime error after failed delivery, got %d events", len(events))
	}
	if events[0].Type != "runtime.error" {
		t.Fatalf("expected runtime error without a user prompt, got %s", events[0].Type)
	}
	if events[0].Sequence != 1 {
		t.Fatalf("expected first sequence to be runtime error, got %d", events[0].Sequence)
	}
	if events[0].Payload["code"] != "runtime_prompt_delivery_failed" {
		t.Fatalf("expected runtime prompt delivery error code, got %#v", events[0].Payload)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 || ch.writes[0]["requestId"] != "command_failed" || ch.writes[0]["accepted"] != false {
		t.Fatalf("expected rejected command acknowledgement, got %#v", ch.writes)
	}
}

func TestRelayRejectsAcknowledgedCommandBeforeBridgeReadyWithoutLegacyBuffering(t *testing.T) {
	workDir := t.TempDir()
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	hub.routeCommand(context.Background(), ch, protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_not_ready"),
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"must not buffer"}`),
	})

	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, string(command))
		return nil
	})
	if len(received) != 0 {
		t.Fatalf("acknowledged command was incorrectly buffered through the legacy path: %v", received)
	}
	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("read prompt log: %v", err)
	}
	if len(events) != 1 || events[0].Type != "runtime.error" {
		t.Fatalf("expected only the failed-delivery runtime error, got %#v", events)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 || ch.writes[0]["accepted"] != false {
		t.Fatalf("expected rejected acknowledgement while bridge is not ready, got %#v", ch.writes)
	}
}

func TestRelayKeepsLegacyCommandBufferingWithoutRequestID(t *testing.T) {
	workDir := t.TempDir()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	hub.routeCommand(context.Background(), newFakeChannel(), protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"legacy buffered prompt"}`),
	})

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})
	if received != `{"type":"send","message":"legacy buffered prompt"}` {
		t.Fatalf("expected legacy command to flush after bridge registration, got %q", received)
	}
}

func TestRelayRejectsCommandForHandlerWithoutCommandSupport(t *testing.T) {
	workDir := t.TempDir()
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	hub.Register("session_1", &closeCountingHandle{})

	hub.routeCommand(context.Background(), ch, protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_unsupported"),
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"must not record"}`),
	})

	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("read prompt log: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("unsupported handler recorded a user prompt: %#v", events)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 || ch.writes[0]["accepted"] != false {
		t.Fatalf("expected rejected command acknowledgement, got %#v", ch.writes)
	}
}

func TestRelayRoutesStopCommandToRegisteredSession(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})

	hub.routeCommand(context.Background(), newFakeChannel(), protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"abort","reason":"user cancelled"}`),
	})

	if received != `{"type":"abort","reason":"user cancelled"}` {
		t.Fatalf("expected stop command routed to session unchanged, got %q", received)
	}
}

func TestRelayRoutesPermissionCommandToRegisteredSession(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)

	var gotID string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		gotID = string(command)
		return nil
	})

	hub.routeCommand(context.Background(), newFakeChannel(), protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"permissionDecision","permissionId":"perm_3","allowed":true}`),
	})

	if gotID != `{"type":"permissionDecision","permissionId":"perm_3","allowed":true}` {
		t.Fatalf("expected permission command routed unchanged, got %q", gotID)
	}
}

func TestRelayDropsCommandForUnregisteredSession(t *testing.T) {
	workDir := t.TempDir()
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	hub.routeCommand(context.Background(), ch, protocol.RunnerChannelMessage{
		Type:      "session.command",
		RequestId: ptr("command_inactive"),
		SessionId: ptr("ghost_session"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":"hello"}`),
	})
	events, err := ReadEventLog(EventLogPath(filepath.Join(workDir, "sessions", "ghost_session")))
	if err != nil {
		t.Fatalf("read inactive session log: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("inactive session recorded a user prompt: %#v", events)
	}
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 || ch.writes[0]["requestId"] != "command_inactive" || ch.writes[0]["accepted"] != false {
		t.Fatalf("expected inactive-session rejection, got %#v", ch.writes)
	}
}

func TestRelayDropsCommandWithEmptySessionID(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	// A command with no sessionId must be silently dropped
	hub.routeCommand(context.Background(), newFakeChannel(), protocol.RunnerChannelMessage{
		Type:    "session.command",
		Command: protocol.RunnerSessionCommand(`{"type":"send","message":"hello"}`),
	})
}

func TestRelayRoutesUnknownCommandTypeOpaque(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)
	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})
	hub.routeCommand(context.Background(), newFakeChannel(), protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"unknown_cmd","payload":{"keep":true}}`),
	})
	if received != `{"type":"unknown_cmd","payload":{"keep":true}}` {
		t.Fatalf("expected unknown command routed opaquely, got %q", received)
	}
}

func TestRelayRoutesPromptCommandWithEmptyMessageOpaque(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	router := NewHostHandle("session_1")
	hub.Register("session_1", router)
	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, string(command))
		return nil
	})
	hub.routeCommand(context.Background(), newFakeChannel(), protocol.RunnerChannelMessage{
		Type:      "session.command",
		SessionId: ptr("session_1"),
		Command:   protocol.RunnerSessionCommand(`{"type":"send","message":""}`),
	})
	if len(received) != 1 || received[0] != `{"type":"send","message":""}` {
		t.Fatalf("expected empty prompt command routed opaquely, got %v", received)
	}
}

func TestRelayHandleWorkAssignedDispatchesValidAssignment(t *testing.T) {
	var gotLeaseID string
	var gotWorkItemID string
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir(), func(_ context.Context, lease *enbor.Lease, workItem *enbor.WorkItem) {
		gotLeaseID = lease.Id
		gotWorkItemID = workItem.Id
	})
	raw, err := json.Marshal(enbor.JSON{
		"type":     "work.assigned",
		"lease":    enbor.JSON{"id": "lease_1", "workItemId": "work_1", "runnerId": "runner_1", "state": "active"},
		"workItem": enbor.JSON{"id": "work_1", "type": "session.start", "payload": enbor.JSON{}, "projectId": "project_1"},
	})
	if err != nil {
		t.Fatal(err)
	}

	hub.handleWorkAssigned(context.Background(), raw)

	if gotLeaseID != "lease_1" || gotWorkItemID != "work_1" {
		t.Fatalf("expected assignment dispatched, got lease=%q work=%q", gotLeaseID, gotWorkItemID)
	}
}

func TestRelayHandleWorkAssignedDropsInvalidFrames(t *testing.T) {
	var calls int
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir(), func(context.Context, *enbor.Lease, *enbor.WorkItem) {
		calls += 1
	})

	hub.handleWorkAssigned(context.Background(), json.RawMessage(`{"lease":{"id":"lease_1"},"workItem":{}}`))
	hub.handleWorkAssigned(context.Background(), json.RawMessage(`[`))

	if calls != 0 {
		t.Fatalf("expected invalid assignments dropped, got %d calls", calls)
	}
}

func TestRelayHandleWorkAssignedNoHandler(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	hub.handleWorkAssigned(context.Background(), json.RawMessage(`{"lease":{"id":"lease_1"},"workItem":{"id":"work_1"}}`))
}

func TestRelayHandlesSandboxRequest(t *testing.T) {
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	toolCallID := "call_1"
	toolName := "bash"
	input := map[string]any{"command": "echo ok"}
	handle := NewSandboxHandle("session_1", testWorkspace(t), &fakeSandboxAdapter{
		result: sandbox.ToolResult{Output: map[string]any{"stdout": "ok\n", "exitCode": 0}},
	}, nil)
	hub.Register("session_1", handle)

	hub.handleSandboxRequest(context.Background(), ch, protocol.RunnerChannelMessage{
		Type:      "sandbox.request",
		RequestId: ptr("request_1"),
		SessionId: ptr("session_1"),
		Request: &enbor.RunnerSandboxRequest{
			Type:       "sandbox.execute",
			ToolCallId: &toolCallID,
			ToolName:   &toolName,
			Input:      &input,
		},
	})

	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) != 1 {
		t.Fatalf("expected one sandbox response, got %d", len(ch.writes))
	}
	response := ch.writes[0]
	if response["type"] != "sandbox.response" || response["ok"] != true {
		t.Fatalf("unexpected sandbox response: %v", response)
	}
	if response["requestId"] != "request_1" || response["runnerId"] != "runner_1" || response["sessionId"] != "session_1" {
		t.Fatalf("response lost routing fields: %v", response)
	}
}

// [spec: runners/enbor-sandbox-channel]
func TestRelayReconnectAdvertisesAllActiveSessions(t *testing.T) {
	opener := &fakeOpener{}
	hub := NewRelay(opener, "runner_1", t.TempDir())
	hub.Register("session_z", &closeCountingHandle{})
	hub.Register("session_a", &closeCountingHandle{})

	for attempt := 0; attempt < 2; attempt++ {
		channel := newFakeChannel(enbor.JSON{"type": "runner.channel.accepted"}, errors.New("connection dropped"))
		opener.channel = channel
		if err := hub.connectAndServe(context.Background()); err == nil {
			t.Fatal("expected relay connection to end after the test channel drops")
		}
		channel.mu.Lock()
		if len(channel.writes) != 1 {
			channel.mu.Unlock()
			t.Fatalf("reconnect %d wrote %d frames", attempt, len(channel.writes))
		}
		got := channel.writes[0]
		channel.mu.Unlock()
		if got["type"] != "runner.sessions.active" || got["runnerId"] != "runner_1" {
			t.Fatalf("reconnect %d wrote wrong active-session frame: %v", attempt, got)
		}
		ids, ok := got["sessionIds"].([]any)
		if !ok || len(ids) != 2 || ids[0] != "session_a" || ids[1] != "session_z" {
			t.Fatalf("reconnect %d did not advertise every sorted active Session: %v", attempt, got)
		}
	}
}

// [spec: runners/enbor-sandbox-channel]
func TestRelaySandboxStopRetiresOnlyAfterSuccess(t *testing.T) {
	t.Run("successful stop unregisters and emits inactive", func(t *testing.T) {
		channel := newFakeChannel()
		hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
		handle := &sandboxRequestHandle{result: enbor.JSON{"ok": true}}
		hub.Register("session_1", handle)

		hub.handleSandboxRequest(context.Background(), channel, protocol.RunnerChannelMessage{
			Type:      "sandbox.request",
			RequestId: ptr("stop_1"),
			SessionId: ptr("session_1"),
			Request:   &enbor.RunnerSandboxRequest{Type: "sandbox.stop"},
		})

		channel.mu.Lock()
		writes := append([]enbor.JSON(nil), channel.writes...)
		channel.mu.Unlock()
		if len(writes) != 2 || writes[0]["type"] != "sandbox.response" || writes[0]["ok"] != true {
			t.Fatalf("successful stop did not return its sandbox response: %v", writes)
		}
		if writes[1]["type"] != "runner.session.inactive" || writes[1]["sessionId"] != "session_1" {
			t.Fatalf("successful stop did not emit inactive: %v", writes)
		}
		hub.mu.Lock()
		_, registered := hub.sessions["session_1"]
		hub.mu.Unlock()
		if registered {
			t.Fatal("successful stop left the sandbox registered")
		}
	})

	t.Run("failed stop remains registered and retryable", func(t *testing.T) {
		channel := newFakeChannel()
		hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
		handle := &sandboxRequestHandle{err: errors.New("sandbox cleanup failed")}
		hub.Register("session_1", handle)
		message := protocol.RunnerChannelMessage{
			Type:      "sandbox.request",
			RequestId: ptr("stop_1"),
			SessionId: ptr("session_1"),
			Request:   &enbor.RunnerSandboxRequest{Type: "sandbox.stop"},
		}

		hub.handleSandboxRequest(context.Background(), channel, message)
		hub.mu.Lock()
		_, registered := hub.sessions["session_1"]
		hub.mu.Unlock()
		if !registered {
			t.Fatal("failed stop removed the sandbox route")
		}
		handle.err = nil
		message.RequestId = ptr("stop_2")
		hub.handleSandboxRequest(context.Background(), channel, message)

		if handle.calls != 2 {
			t.Fatalf("expected failed stop to remain retryable, got %d calls", handle.calls)
		}
		channel.mu.Lock()
		writes := append([]enbor.JSON(nil), channel.writes...)
		channel.mu.Unlock()
		if len(writes) != 3 || writes[0]["ok"] != false || writes[1]["ok"] != true || writes[2]["type"] != "runner.session.inactive" {
			t.Fatalf("unexpected failed-stop retry frames: %v", writes)
		}
	})
}

func TestRelayHandlesSandboxRequestErrors(t *testing.T) {
	t.Run("inactive session", func(t *testing.T) {
		ch := newFakeChannel()
		hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
		hub.handleSandboxRequest(context.Background(), ch, protocol.RunnerChannelMessage{
			Type:      "sandbox.request",
			RequestId: ptr("request_1"),
			SessionId: ptr("missing"),
			Request:   &enbor.RunnerSandboxRequest{Type: "sandbox.execute"},
		})
		ch.mu.Lock()
		defer ch.mu.Unlock()
		if ch.writes[0]["ok"] != false || ch.writes[0]["error"] == nil {
			t.Fatalf("expected inactive session error, got %v", ch.writes[0])
		}
	})
	t.Run("wrong handler type", func(t *testing.T) {
		ch := newFakeChannel()
		hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
		hub.Register("session_1", NewHostHandle("session_1"))
		hub.handleSandboxRequest(context.Background(), ch, protocol.RunnerChannelMessage{
			Type:      "sandbox.request",
			RequestId: ptr("request_2"),
			SessionId: ptr("session_1"),
			Request:   &enbor.RunnerSandboxRequest{Type: "sandbox.execute"},
		})
		ch.mu.Lock()
		defer ch.mu.Unlock()
		if ch.writes[0]["ok"] != false || ch.writes[0]["error"] == nil {
			t.Fatalf("expected unsupported handler error, got %v", ch.writes[0])
		}
	})
	t.Run("handler error", func(t *testing.T) {
		ch := newFakeChannel()
		hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
		hub.Register("session_1", NewSandboxHandle("session_1", nil, &fakeSandboxAdapter{}, nil))
		hub.handleSandboxRequest(context.Background(), ch, protocol.RunnerChannelMessage{
			Type:      "sandbox.request",
			RequestId: ptr("request_3"),
			SessionId: ptr("session_1"),
			Request:   &enbor.RunnerSandboxRequest{Type: "sandbox.execute"},
		})
		ch.mu.Lock()
		defer ch.mu.Unlock()
		if ch.writes[0]["ok"] != false || ch.writes[0]["error"] == nil {
			t.Fatalf("expected handler error, got %v", ch.writes[0])
		}
	})
}

func TestRelayUnregisterClosesHandle(t *testing.T) {
	handle := &closeCountingHandle{}
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	hub.Register("session_1", handle)
	hub.Unregister("session_1")
	hub.Unregister("session_1")

	if handle.calls != 1 {
		t.Fatalf("expected handle closed once, got %d", handle.calls)
	}
}

func TestRelayUnregisterLogsCloseError(t *testing.T) {
	handle := &closeCountingHandle{err: errors.New("close failed")}
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	hub.Register("session_1", handle)
	hub.Unregister("session_1")
	if handle.calls != 1 {
		t.Fatalf("expected close attempted once, got %d", handle.calls)
	}
}

func TestRelayNotifyWorkFinishedWritesTerminalStates(t *testing.T) {
	ch := newFakeChannel()
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	hub.setConn(ch)

	for _, tc := range []struct {
		state string
		typ   string
	}{
		{state: "completed", typ: "work.completed"},
		{state: "failed", typ: "work.failed"},
		{state: "cancelled", typ: "work.cancelled"},
	} {
		hub.NotifyWorkFinished(context.Background(), "session_1", "lease_1", tc.state, false)
		ch.mu.Lock()
		got := ch.writes[len(ch.writes)-1]
		ch.mu.Unlock()
		if got["type"] != tc.typ || got["sessionId"] != "session_1" || got["leaseId"] != "lease_1" {
			t.Fatalf("state %q wrote wrong frame: %v", tc.state, got)
		}
	}

	hub.NotifyWorkFinished(context.Background(), "session_1", "lease_1", "completed", true)
	ch.mu.Lock()
	got := ch.writes[len(ch.writes)-1]
	ch.mu.Unlock()
	if got["sessionActive"] != true {
		t.Fatalf("expected completed Enbor sandbox startup to retain the session channel: %v", got)
	}
}

func TestRelayNotifyWorkFinishedDropsWhenDisconnectedOrWriteFails(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	hub.NotifyWorkFinished(context.Background(), "session_1", "lease_1", "completed", false)
	hub.setConn(&errWriteChannel{})
	hub.NotifyWorkFinished(context.Background(), "session_1", "lease_1", "completed", false)
}

func TestRelayHandlesBackfillForCompletedSession(t *testing.T) {
	workDir := t.TempDir()
	sessionDir := filepath.Join(workDir, "sessions", "completed_session")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	logPath := EventLogPath(sessionDir)
	events := []Event{
		{
			ID: "evt_1", SessionID: "completed_session", Sequence: 1,
			Type:      "message.completed",
			Payload:   enbor.JSON{"text": "hi"},
			CreatedAt: "2026-01-01T00:00:01Z",
		},
		{
			ID: "evt_2", SessionID: "completed_session", Sequence: 2,
			Type:      "usage.recorded",
			Payload:   enbor.JSON{"tokens": 42},
			CreatedAt: "2026-01-01T00:00:02Z",
		},
	}
	f, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range events {
		line, _ := json.Marshal(ev)
		_, _ = fmt.Fprintf(f, "%s\n", line)
	}
	f.Close()

	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	// No live session registered — hub must serve from disk.

	conn := newFakeChannel()
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventId:   ptr("req_1"),
		SessionId: ptr("completed_session"),
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response, got %d", len(conn.writes))
	}
	resp := conn.writes[0]
	if resp["type"] != "session.backfill_response" {
		t.Fatalf("expected backfill_response type, got %v", resp["type"])
	}
	if resp["sessionId"] != "completed_session" {
		t.Fatalf("expected sessionId completed_session, got %v", resp["sessionId"])
	}
	if resp["eventId"] != "req_1" {
		t.Fatalf("expected eventId req_1, got %v", resp["eventId"])
	}
	storedEventsRaw, _ := json.Marshal(resp["events"])
	if string(storedEventsRaw) == "null" || string(storedEventsRaw) == "[]" {
		t.Fatalf("expected stored events in backfill response, got %s", storedEventsRaw)
	}
}

func TestRelayHandlesBackfillForSessionWithNoLog(t *testing.T) {
	workDir := t.TempDir()
	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)

	conn := newFakeChannel()
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventId:   ptr("req_2"),
		SessionId: ptr("nonexistent_session"),
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response for nonexistent session, got %d", len(conn.writes))
	}
	resp := conn.writes[0]
	if resp["type"] != "session.backfill_response" {
		t.Fatalf("expected backfill_response type, got %v", resp["type"])
	}
}

func TestRelayHandlesBackfillWithEmptySessionID(t *testing.T) {
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	conn := newFakeChannel()
	// Empty sessionId must return an empty events list without error
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:    "session.backfill_request",
		EventId: ptr("req_3"),
	})
	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response even for empty sessionId, got %d", len(conn.writes))
	}
}

func TestRelayWaitForChannelAcceptedReturnsReadError(t *testing.T) {
	// waitForChannelAccepted must return the error when ReadJSON fails (e.g. opener returns a
	// channel that immediately errors before the accepted handshake frame).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Channel returns an error as its very first read — simulates a connection that
	// drops during the handshake phase.
	ch := newFakeChannel(errors.New("handshake dropped"))
	opener := &countingOpener{channels: []*fakeChannel{
		ch,
		// Second connection blocks forever so the hub doesn't loop infinitely.
		newFakeChannel(enbor.JSON{"type": "runner.channel.accepted"}),
	}, count: new(int)}

	hub := NewRelay(opener, "runner_1", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Hub must attempt reconnect after the handshake error. Wait for second open.
	deadline := time.After(5 * time.Second)
	for {
		opener.mu.Lock()
		c := *opener.count
		opener.mu.Unlock()
		if c >= 2 {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out waiting for reconnect after handshake error")
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	cancel()
	<-done
}

func TestRelayEventLogsWhenWriteFails(t *testing.T) {
	// relayEvent must log and not panic when conn.WriteJSON returns an error.
	ch := &errWriteChannel{}
	hub := NewRelay(&fakeOpener{}, "runner_1", t.TempDir())
	hub.setConn(ch)
	// Must not panic.
	hub.RelayEvent(context.Background(), "session_1", enbor.JSON{"type": "message.completed", "payload": enbor.JSON{}}, nil)
}

// errWriteChannel is a Channel whose WriteJSON always errors.
type errWriteChannel struct{}

func (e *errWriteChannel) ReadJSON(ctx context.Context, out any) error { return ctx.Err() }
func (e *errWriteChannel) WriteJSON(_ context.Context, _ any) error    { return errors.New("write error") }
func (e *errWriteChannel) Close(int, string) error                     { return nil }

func ptr[T any](value T) *T {
	return &value
}

func TestRelayHandlesBackfillWithReadError(t *testing.T) {
	workDir := t.TempDir()
	sessionDir := filepath.Join(workDir, "sessions", "bad_session")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, "events.jsonl"), []byte("not json\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	hub := NewRelay(&fakeOpener{}, "runner_1", workDir)
	conn := newFakeChannel()
	hub.handleBackfillRequest(context.Background(), conn, protocol.RunnerChannelMessage{
		Type:      "session.backfill_request",
		EventId:   ptr("req_err"),
		SessionId: ptr("bad_session"),
	})

	conn.mu.Lock()
	defer conn.mu.Unlock()
	if len(conn.writes) != 1 {
		t.Fatalf("expected 1 backfill response, got %d", len(conn.writes))
	}
	resp := conn.writes[0]
	if resp["type"] != "session.backfill_response" {
		t.Fatalf("expected backfill_response, got %v", resp["type"])
	}
	if resp["error"] == nil {
		t.Fatal("expected error field in backfill response for unreadable session")
	}
}

func TestRelayConnectsAndDisconnectsGracefully(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := newFakeChannel(
		enbor.JSON{"type": "runner.channel.accepted"},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", t.TempDir())

	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Wait for hub to connect (conn becomes non-nil)
	deadline := time.After(time.Second)
	for {
		hub.writeMu.Lock()
		connected := hub.conn != nil
		hub.writeMu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for hub to connect")
		default:
			time.Sleep(time.Millisecond)
		}
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for hub to stop")
	}
}

func TestRelayReconnectsAfterConnectionDrop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// First connection drops immediately (EOF), second blocks until cancel.
	connCount := 0
	ch1 := newFakeChannel(
		enbor.JSON{"type": "runner.channel.accepted"},
		errors.New("connection reset"),
	)
	ch2 := newFakeChannel(
		enbor.JSON{"type": "runner.channel.accepted"},
	)
	opener := &countingOpener{channels: []*fakeChannel{ch1, ch2}, count: &connCount}
	hub := NewRelay(opener, "runner_1", t.TempDir())
	// Shrink reconnect delay to avoid 3s wait in test.
	// We can't set the constant, but we can rely on the test waiting for 2 opens.

	go hub.Run(ctx)

	deadline := time.After(5 * time.Second)
	for {
		opener.mu.Lock()
		c := connCount
		opener.mu.Unlock()
		if c >= 2 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for reconnect; got %d opens", c)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func TestRelayReadLoopDropsNonObjectMessages(t *testing.T) {
	// The read loop must drop JSON arrays (non-objects) without crashing.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeChannel(
		enbor.JSON{"type": "runner.channel.accepted"},
		// Push a JSON array — valid JSON but not an object; readLoop must drop and continue.
		[]any{1, 2, 3},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Wait for hub to connect (non-nil conn), then cancel so the run loop exits cleanly.
	deadline := time.After(time.Second)
	for {
		hub.writeMu.Lock()
		connected := hub.conn != nil
		hub.writeMu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out: hub did not connect")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out: hub did not exit after context cancel")
	}
}

func TestRelayReadLoopIgnoresAdvisoryMessages(t *testing.T) {
	// The read loop must silently ignore runner.event.accepted and other advisory types.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeChannel(
		enbor.JSON{"type": "runner.channel.accepted"},
		// Advisory frame — must hit the default: branch in the switch.
		enbor.JSON{"type": "runner.event.accepted", "eventId": "evt_1"},
		// Session channel error advisory.
		enbor.JSON{"type": "session.channel.error", "message": "some error"},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	// Wait for hub to connect, then cancel.
	deadline := time.After(time.Second)
	for {
		hub.writeMu.Lock()
		connected := hub.conn != nil
		hub.writeMu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out: hub did not connect")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out: hub did not exit after context cancel")
	}
}

func TestRelayWaitForChannelAcceptedDiscardsNonAcceptedFrames(t *testing.T) {
	// waitForChannelAccepted must skip frames that are not runner.channel.accepted.
	ctx, cancel := context.WithCancel(context.Background())

	ch := newFakeChannel(
		// Unrelated frame first.
		enbor.JSON{"type": "runner.event.accepted", "eventId": "stray"},
		// Accepted frame second.
		enbor.JSON{"type": "runner.channel.accepted"},
	)
	hub := NewRelay(&fakeOpener{channel: ch}, "runner_1", t.TempDir())
	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()
	// Hub must connect (non-nil conn) after discarding the stray frame.
	deadline := time.After(time.Second)
	for {
		hub.writeMu.Lock()
		connected := hub.conn != nil
		hub.writeMu.Unlock()
		if connected {
			break
		}
		select {
		case <-deadline:
			cancel()
			t.Fatal("timed out: hub did not connect after discarding stray frame")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out: hub did not exit after context cancel")
	}
}

type countingOpener struct {
	mu       sync.Mutex
	channels []*fakeChannel
	count    *int
}

func (o *countingOpener) Channel(_ context.Context, _ string) (Channel, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	idx := *o.count
	*o.count++
	if idx < len(o.channels) {
		return o.channels[idx], nil
	}
	return newFakeChannel(), nil
}
