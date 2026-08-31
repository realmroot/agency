package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/host"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"github.com/samber/lo"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const amaRuntimeCapability = "ama"

// fakeWork pairs a v1 lease with the work item the runner fetches after
// claiming it; the lease no longer embeds the work item.
type fakeWork struct {
	lease    *ama.Lease
	workItem *ama.WorkItem
}

type fakeAMAServer struct {
	mu                sync.Mutex
	creates           []ama.CreateRunnerRequest
	heartbeats        []ama.PutRunnerHeartbeatRequest
	updates           []ama.UpdateLeaseRequest
	events            [][]ama.JSON
	lease             *fakeWork
	runnerID          string
	claims            int
	configErr         error
	createErr         error
	heartbeatErr      error
	heartbeatStatus   int
	heartbeatErrAfter int
	heartbeatStatuses []int
	claimErr          error
	leaseCreateErr    error
	leaseStatus       int
	eventErr          error
	updateErr         error
	hubChannel        *fakeSessionChannel
	channelErr        error
	opens             int
	config            *ama.PublicConfig
	server            *httptest.Server
	sdk               *ama.RunnerClient
}

func (f *fakeAMAServer) sdkClient() *ama.RunnerClient {
	if f.sdk != nil {
		return f.sdk
	}
	f.server = httptest.NewServer(f)
	sdk, err := ama.NewRunner(ama.ClientConfig{BaseURL: f.server.URL})
	if err != nil {
		panic(err)
	}
	f.sdk = sdk
	return sdk
}

func fakePublicConfig() ama.PublicConfig {
	return ama.PublicConfig{
		Version: ama.N1,
		Service: ama.PublicServiceConfig{
			Name:   ama.AnyManagedAgents,
			Origin: "https://ama.example.test",
		},
	}
}

func (f *fakeAMAServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/configz":
		if f.configErr != nil {
			writeAPIError(w, http.StatusInternalServerError, f.configErr)
			return
		}
		if f.config != nil {
			writeJSON(w, http.StatusOK, f.config)
			return
		}
		writeJSON(w, http.StatusOK, fakePublicConfig())
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/runners":
		if f.createErr != nil {
			writeAPIError(w, http.StatusInternalServerError, f.createErr)
			return
		}
		var body ama.CreateRunnerRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, err)
			return
		}
		f.mu.Lock()
		f.creates = append(f.creates, body)
		runnerID := f.runnerID
		if runnerID == "" {
			runnerID = "runner_1"
		}
		f.mu.Unlock()
		writeJSON(w, http.StatusCreated, fakeRunnerResource(runnerID, body.Name))
	case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/v1/runners/") && strings.HasSuffix(r.URL.Path, "/heartbeat"):
		f.mu.Lock()
		heartbeatCount := len(f.heartbeats)
		statuses := append([]int(nil), f.heartbeatStatuses...)
		if len(f.heartbeatStatuses) > 0 && heartbeatCount >= f.heartbeatErrAfter {
			f.heartbeatStatuses = f.heartbeatStatuses[1:]
		}
		f.mu.Unlock()
		if len(statuses) > 0 && heartbeatCount >= f.heartbeatErrAfter {
			writeAPIError(w, statuses[0], fmt.Errorf("heartbeat status %d", statuses[0]))
			return
		}
		if f.heartbeatErr != nil && (f.heartbeatErrAfter == 0 || heartbeatCount >= f.heartbeatErrAfter) {
			status := f.heartbeatStatus
			if status == 0 {
				status = http.StatusInternalServerError
			}
			writeAPIError(w, status, f.heartbeatErr)
			return
		}
		var body ama.PutRunnerHeartbeatRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, err)
			return
		}
		f.mu.Lock()
		f.heartbeats = append(f.heartbeats, body)
		f.mu.Unlock()
		state := ama.RunnerHeartbeatStateActive
		if body.State != nil {
			state = ama.RunnerHeartbeatState(*body.State)
		}
		writeJSON(w, http.StatusOK, ama.RunnerHeartbeat{RunnerId: "runner_1", State: state})
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/work-items":
		f.mu.Lock()
		f.claims += 1
		lease := f.lease
		f.mu.Unlock()
		if f.claimErr != nil {
			writeAPIError(w, http.StatusInternalServerError, f.claimErr)
			return
		}
		data := []ama.WorkItem{}
		if lease != nil {
			data = append(data, *lease.workItem)
		}
		writeJSON(w, http.StatusOK, ama.WorkItemListResponse{Data: data, Pagination: ama.ListPagination{Limit: len(data)}})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/work-items/"):
		if f.lease == nil {
			writeAPIError(w, http.StatusNotFound, fmt.Errorf("work item not found"))
			return
		}
		writeJSON(w, http.StatusOK, f.lease.workItem)
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/leases":
		f.mu.Lock()
		lease := f.lease
		f.mu.Unlock()
		data := []ama.Lease{}
		if lease != nil {
			data = append(data, *lease.lease)
		}
		writeJSON(w, http.StatusOK, ama.LeaseListResponse{Data: data, Pagination: ama.ListPagination{Limit: len(data)}})
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/leases":
		if f.lease == nil {
			writeAPIError(w, http.StatusInternalServerError, fmt.Errorf("no work item to lease"))
			return
		}
		if f.leaseCreateErr != nil {
			status := f.leaseStatus
			if status == 0 {
				status = http.StatusInternalServerError
			}
			writeAPIError(w, status, f.leaseCreateErr)
			return
		}
		writeJSON(w, http.StatusCreated, f.lease.lease)
	case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/api/v1/leases/"):
		var body ama.UpdateLeaseRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, err)
			return
		}
		f.mu.Lock()
		f.updates = append(f.updates, body)
		f.mu.Unlock()
		if f.updateErr != nil {
			writeAPIError(w, http.StatusInternalServerError, f.updateErr)
			return
		}
		if f.lease == nil {
			writeJSON(w, http.StatusOK, ama.Lease{})
			return
		}
		writeJSON(w, http.StatusOK, f.lease.lease)
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/v1/sessions/") && strings.HasSuffix(r.URL.Path, "/events"):
		if f.eventErr != nil {
			writeAPIError(w, http.StatusInternalServerError, f.eventErr)
			return
		}
		var body struct {
			Events []ama.JSON `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeAPIError(w, http.StatusBadRequest, err)
			return
		}
		f.mu.Lock()
		f.events = append(f.events, body.Events)
		f.mu.Unlock()
		writeJSON(w, http.StatusCreated, ama.SessionEventsAccepted{Accepted: len(body.Events)})
	default:
		writeAPIError(w, http.StatusNotFound, fmt.Errorf("unexpected request %s %s", r.Method, r.URL.Path))
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeAPIError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, ama.ErrorResponse{Error: struct {
		Details *map[string]interface{} `json:"details,omitempty"`
		Issues  *[]interface{}          `json:"issues,omitempty"`
		Message string                  `json:"message"`
		Type    string                  `json:"type"`
	}{Message: err.Error(), Type: "test_error"}})
}

func fakeRunnerResource(id string, name string) ama.Runner {
	return ama.Runner{
		AuthMode:      ama.RunnerAuthModeRealmroot,
		CreatedAt:     time.Now(),
		CurrentLoad:   0,
		Id:            id,
		MaxConcurrent: 1,
		Metadata:      ama.JSON{},
		Name:          name,
		ProjectId:     "project_1",
		State:         ama.RunnerStateActive,
		UpdatedAt:     time.Now(),
	}
}

func (f *fakeAMAServer) Channel(context.Context, string) (runnersession.Channel, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.opens += 1
	if f.channelErr != nil {
		return nil, f.channelErr
	}
	if f.hubChannel == nil {
		f.hubChannel = newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	}
	return f.hubChannel, nil
}

type fakeAdapter struct {
	waitForCancel bool
	result        sandbox.ToolResult
	err           error
	cancelled     atomic.Bool
	mu            sync.Mutex
	requests      []sandbox.ToolRequest
}

type fakeRuntimeAdapter struct {
	mu            sync.Mutex
	request       runtime.Request
	events        []RuntimeEvent
	result        ama.JSON
	err           error
	inspect       func(runtime.Request) error
	waitForCancel bool
}

type RuntimeEvent struct {
	Event ama.JSON
}

func runtimeEvent(eventType string, payload ama.JSON) RuntimeEvent {
	return RuntimeEvent{Event: ama.JSON{"type": eventType, "payload": payload}}
}

func runtimeToolCallMessage(toolCallID, toolName string, input ama.JSON) RuntimeEvent {
	return runtimeEvent("message.completed", ama.JSON{
		"message": ama.JSON{
			"id":   "msg_" + toolCallID,
			"role": "assistant",
			"content": []any{ama.JSON{
				"type": "tool_call",
				"toolCall": ama.JSON{
					"id":    toolCallID,
					"name":  toolName,
					"input": input,
				},
			}},
		},
	})
}

func runtimeToolResultMessage(toolCallID string, output ama.JSON) RuntimeEvent {
	return runtimeEvent("message.completed", ama.JSON{
		"message": ama.JSON{
			"id":               "msg_result_" + toolCallID,
			"role":             "tool",
			"parentToolCallId": toolCallID,
			"content": []any{ama.JSON{
				"type":       "tool_result",
				"toolCallId": toolCallID,
				"result": ama.JSON{
					"content":           []any{ama.JSON{"type": "text", "text": "ok"}},
					"structuredContent": output,
				},
			}},
		},
	})
}

type fakeSessionChannel struct {
	mu          sync.Mutex
	reads       chan any
	writes      []ama.JSON
	closed      bool
	eventErrors map[string]string
	autoAck     bool
}

func newFakeSessionChannel(reads ...any) *fakeSessionChannel {
	channel := &fakeSessionChannel{reads: make(chan any, 16), autoAck: true}
	for _, read := range reads {
		channel.reads <- read
	}
	return channel
}

func (ch *fakeSessionChannel) ReadJSON(ctx context.Context, out any) error {
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

func (ch *fakeSessionChannel) WriteJSON(_ context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded ama.JSON
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	ch.mu.Lock()
	ch.writes = append(ch.writes, decoded)
	ch.mu.Unlock()
	if decoded["type"] == "runner.event" {
		record, _ := decoded["record"].(map[string]any)
		if eventID, ok := record["id"].(string); ok && eventID != "" {
			eventType, _ := record["type"].(string)
			if message := ch.eventErrors[eventType]; message != "" {
				ch.reads <- ama.JSON{"type": "session.channel.error", "eventId": eventID, "message": message}
			} else if ch.autoAck {
				ch.reads <- ama.JSON{"type": "runner.event.accepted", "eventId": eventID}
			}
		}
	}
	return nil
}

func (ch *fakeSessionChannel) Close(int, string) error {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.closed = true
	return nil
}

func (ch *fakeSessionChannel) push(value any) {
	ch.reads <- value
}

func (ch *fakeSessionChannel) lastWriteEventID() string {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	if len(ch.writes) == 0 {
		return ""
	}
	record, _ := ch.writes[len(ch.writes)-1]["record"].(map[string]any)
	eventID, _ := record["id"].(string)
	return eventID
}

func (ch *fakeSessionChannel) writeCount() int {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	return len(ch.writes)
}

func (ch *fakeSessionChannel) writtenEvents() []string {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	events := make([]string, 0, len(ch.writes))
	for _, write := range ch.writes {
		record, _ := write["record"].(map[string]any)
		if eventType, ok := record["type"].(string); ok {
			events = append(events, eventType)
		}
	}
	return events
}

func (ch *fakeSessionChannel) writtenMessages() []ama.JSON {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	messages := make([]ama.JSON, len(ch.writes))
	copy(messages, ch.writes)
	return messages
}

func (a *fakeAdapter) Execute(ctx context.Context, request sandbox.ToolRequest) (sandbox.ToolResult, error) {
	a.mu.Lock()
	a.requests = append(a.requests, request)
	a.mu.Unlock()
	if !a.waitForCancel {
		return a.result, a.err
	}
	<-ctx.Done()
	a.cancelled.Store(true)
	return sandbox.ToolResult{}, ctx.Err()
}

func (a *fakeAdapter) lastRequest() sandbox.ToolRequest {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.requests) == 0 {
		return sandbox.ToolRequest{}
	}
	return a.requests[len(a.requests)-1]
}

func (a *fakeAdapter) requestCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.requests)
}

func (a *fakeRuntimeAdapter) Run(ctx context.Context, request runtime.Request, write runtime.EventWriter) (runtime.JSON, error) {
	a.mu.Lock()
	a.request = request
	a.mu.Unlock()
	if a.inspect != nil {
		if err := a.inspect(request); err != nil {
			return nil, err
		}
	}
	if a.waitForCancel {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	events := a.events
	if len(events) == 0 {
		events = []RuntimeEvent{
			runtimeEvent("message.completed", ama.JSON{
				"message": ama.JSON{
					"id":      "msg_runtime_ok",
					"role":    "assistant",
					"content": []any{ama.JSON{"type": "text", "text": "runtime ok"}},
				},
			}),
		}
	}
	for _, event := range events {
		if err := write(runtime.JSON(event.Event)); err != nil {
			return nil, err
		}
	}
	return runtime.JSON(a.result), a.err
}

func (a *fakeRuntimeAdapter) lastRequest() runtime.Request {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.request
}

func TestRunOnceSendsHeartbeatAndCompletesApprovedToolWork(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease()}
	adapter := &fakeAdapter{result: sandbox.ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run once success, got %v", err)
	}
	if len(client.heartbeats) != 1 {
		t.Fatalf("expected heartbeat before claim, got %d", len(client.heartbeats))
	}
	if len(client.creates) != 0 {
		t.Fatalf("expected existing runner id to skip registration, got %d registrations", len(client.creates))
	}
	if daemon.RunnerID != "runner_1" {
		t.Fatalf("expected configured runner id, got %q", daemon.RunnerID)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed update, got %#v", client.updates)
	}
	if len(client.events) != 2 {
		t.Fatalf("expected started and completed events, got %#v", client.events)
	}
}

// [spec: runners/heartbeat]
func TestRunOnceProbesRuntimeUsageBeforeFirstHeartbeat(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	var callsMu sync.Mutex
	var includeUsageCalls []bool
	daemon.RuntimeCatalog = usageUnavailableRuntimeCatalog(&callsMu, &includeUsageCalls)

	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run once success, got %v", err)
	}

	callsMu.Lock()
	calls := append([]bool(nil), includeUsageCalls...)
	callsMu.Unlock()
	if !slices.Equal(calls, []bool{true, false}) {
		t.Fatalf("expected usage probe before runtime heartbeat inventory, got %v", calls)
	}
	claude, found := lo.Find(heartbeatRuntimes(client.heartbeats[0]), func(entry ama.RunnerRuntime) bool {
		return entry.Runtime == "claude-code"
	})
	if !found || claude.State != "limited" {
		t.Fatalf("expected first heartbeat to report unavailable claude-code usage as limited, got %#v", claude)
	}
}

func TestRunOnceRejectsConcurrentProcessForSameStateDir(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	releaseLock, err := acquireStateDirLock(daemon.Config.StateDir)
	if err != nil {
		t.Fatalf("acquire lock: %v", err)
	}
	defer releaseLock()

	err = daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "already running with state directory") {
		t.Fatalf("expected state dir lock error, got %v", err)
	}
	if len(client.heartbeats) != 0 {
		t.Fatalf("expected no control-plane calls after lock failure, got %d heartbeats", len(client.heartbeats))
	}
}

func TestRunOnceRegistersRunnerWhenIDIsMissing(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease(), runnerID: "runner_registered"}
	adapter := &fakeAdapter{result: sandbox.ToolResult{Output: map[string]any{"stdout": "ok", "stderr": "", "exitCode": 0}}}
	daemon := testDaemon(client, adapter)
	daemon.RunnerID = ""
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run once success, got %v", err)
	}
	if daemon.RunnerID != "runner_registered" {
		t.Fatalf("expected registered runner id, got %q", daemon.RunnerID)
	}
	if len(client.creates) != 1 {
		t.Fatalf("expected runner registration, got %#v", client.creates)
	}
	build := version.Default()
	if got := createMetadata(client.creates[0])["runnerVersion"]; got != build.Version {
		t.Fatalf("expected runner version metadata %q, got %#v", build.Version, got)
	}
	if got := createMetadata(client.creates[0])["runnerCommit"]; got != build.Commit {
		t.Fatalf("expected runner commit metadata %q, got %#v", build.Commit, got)
	}
	if got := createMetadata(client.creates[0])["commandAcknowledgement"]; got != true {
		t.Fatalf("expected command acknowledgement capability in create metadata, got %#v", got)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed update, got %#v", client.updates)
	}
}

// AMA no longer hosts its full loop inside the runner. For AMA sessions, the
// cloud loop sends sandbox tool requests over the runner channel; external
// runtimes still run through the bridge subprocess. The old runner-local AMA
// full-loop path is intentionally absent from the full-flow tests.

func TestRunOnceCancelsSessionChannelWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	// All runtimes now relay over the per-runner hub channel. Seed it so the hub
	// connects immediately and the relay path is live when the session starts.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: codexSessionStartLease("run until cancelled"), hubChannel: hubChannel}
	daemon := testDaemon(client, &fakeAdapter{})
	// CLI-backed runtimes run via the bridge runtime adapter; block it until the run context is
	// cancelled so this exercises the channel cancellation path.
	runtimeAdapter := &fakeRuntimeAdapter{waitForCancel: true}
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(ctx)
	}()
	waitForRuntimeRequest(t, runtimeAdapter, done)
	cancel()
	select {
	case err := <-done:
		// The bridge runtime adapter surfaces the cancellation as ctx.Err();
		// the lease is still finalized as interrupted for server-side resume.
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation to succeed or report context cancellation, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cancelled session channel")
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "interrupted" {
		t.Fatalf("expected interrupted lease update, got %#v", client.updates)
	}
}

func TestRunOnceDispatchesCodexRuntimeThroughAdapterAndCompletesSessionLease(t *testing.T) {
	workDir := t.TempDir()
	prompt := "build the feature"
	lease := codexSessionStartLease(prompt)
	lease.workItem.Payload["agentSnapshot"] = ama.JSON{
		"systemPrompt":  "Follow the AMA runtime protocol.",
		"skills":        []any{},
		"subagents":     []any{ama.JSON{"name": "reviewer", "description": "Reviews pull requests", "systemPrompt": "Review strictly."}},
		"allowedTools":  []any{"bash"},
		"mcpConnectors": []any{},
	}
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel,
	// not a per-lease channel. Seed the hub channel with runner.channel.accepted
	// so the hub connects without delay.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: lease, hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0, "providerThreadId": "codex_thread_1"},
		inspect: func(request runtime.Request) error {
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "agent.json")); !os.IsNotExist(err) {
				return fmt.Errorf("expected no agent snapshot manifest in workspace, got err=%v", err)
			}
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "system-prompt.md")); !os.IsNotExist(err) {
				return fmt.Errorf("expected no system prompt file in workspace, got err=%v", err)
			}
			if _, err := os.Stat(filepath.Join(request.WorkDir, ".ama", "resources.json")); !os.IsNotExist(err) {
				return fmt.Errorf("expected no legacy workspace manifest, got err=%v", err)
			}
			return nil
		},
		events: []RuntimeEvent{
			runtimeEvent("message.completed", ama.JSON{"message": ama.JSON{"role": "assistant", "content": []any{ama.JSON{"type": "text", "text": "prompt:build the feature"}}}}),
			runtimeToolCallMessage("tool_1", "bash", ama.JSON{"command": "printf ok"}),
			runtimeToolResultMessage("tool_1", ama.JSON{"stdout": "ok", "stderr": "", "exitCode": 0}),
			runtimeEvent("usage.recorded", ama.JSON{"provider": "provider_codex", "model": "gpt-5.3-codex", "inputTokens": 4, "outputTokens": 5, "totalTokens": 9}),
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.RuntimeCatalog = runtimesFor(runtimeEntry("codex", true, []string{"gpt-5.3-codex"}, nil, "ready", "", "ready"))
	daemon.Config.WorkDir = workDir
	// Run in a goroutine: the hub connects asynchronously, so wait for relay
	// events to appear on hubChannel before asserting.
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for the first canonical runtime event to be relayed over the hub channel.
	waitForChannelWriteCount(t, hubChannel, 1)
	if err := <-done; err != nil {
		t.Fatalf("expected codex run success, got %v", err)
	}
	if runtimeAdapter.request.Runtime != "codex" ||
		runtimeAdapter.request.Prompt != prompt ||
		runtimeAdapter.request.Provider != "provider_codex" ||
		runtimeAdapter.request.Model != "gpt-5.3-codex" {
		t.Fatalf("expected runtime request metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.WorkDir == workDir || !strings.HasSuffix(runtimeAdapter.request.WorkDir, filepath.Join("sessions", "session_1", "workspace")) {
		t.Fatalf("expected isolated session workspace, got %q from root %q", runtimeAdapter.request.WorkDir, workDir)
	}
	if runtimeAdapter.request.RuntimeConfig["model"] != "gpt-5.3-codex" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if runtimeAdapter.request.AgentSnapshot["systemPrompt"] != "Follow the AMA runtime protocol." {
		t.Fatalf("expected agent snapshot to reach adapter, got %#v", runtimeAdapter.request.AgentSnapshot)
	}
	if _, err := os.Stat(runtimeAdapter.request.WorkDir); err != nil {
		t.Fatalf("expected completed session workspace to remain inspectable, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	if updateResult(client.updates[0])["providerThreadId"] != "codex_thread_1" {
		t.Fatalf("expected adapter result to complete lease, got %#v", updateResult(client.updates[0]))
	}
	if len(client.events) != 0 {
		t.Fatalf("expected codex session to write runtime events on channel without HTTP uploads, got %#v", client.events)
	}
	gotTypes := hubChannel.writtenEvents()
	for _, want := range []string{
		"message.completed",
		"usage.recorded",
	} {
		if !lo.Contains(gotTypes, want) {
			t.Fatalf("expected channel/uploaded events to include %q, got %v", want, gotTypes)
		}
	}
	for _, message := range hubChannel.writtenMessages() {
		if message["type"] != "runner.event" {
			t.Fatalf("expected codex event to use runner session channel envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if strings.Contains(serializedEvents, "AMA_TOKEN") {
		t.Fatalf("expected safe codex environment, got %s", serializedEvents)
	}
	if !strings.Contains(serializedEvents, "prompt:build the feature") ||
		!strings.Contains(serializedEvents, `"role":"user"`) ||
		!strings.Contains(serializedEvents, `"text":"build the feature"`) ||
		!strings.Contains(serializedEvents, "provider_codex") ||
		!strings.Contains(serializedEvents, "gpt-5.3-codex") {
		t.Fatalf("expected prompt/provider/model events, got %s", serializedEvents)
	}
}

func TestRunOnceCompletesSessionLeaseWithWritableMemoryStoreSnapshot(t *testing.T) {
	workDir := t.TempDir()
	lease := codexSessionStartLease("update the heartbeat")
	lease.workItem.Payload["workspaceManifest"] = ama.JSON{
		"root": "/workspace",
		"mounts": []any{ama.JSON{
			"type":      "memory",
			"name":      "maintainer-memory",
			"mountPath": "/workspace/.ama/memory-stores/memstore_1",
			"memoryRef": "ama://memories/memstore_1",
			"readOnly":  false,
			"files": []any{ama.JSON{
				"path":    "ak-maintainer-heartbeat.md",
				"content": "initial heartbeat\n",
			}},
		}},
	}
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: lease, hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0},
		inspect: func(request runtime.Request) error {
			memoryPath := filepath.Join(request.WorkDir, ".ama", "memory-stores", "memstore_1", "ak-maintainer-heartbeat.md")
			data, err := os.ReadFile(memoryPath)
			if err != nil {
				return err
			}
			if string(data) != "initial heartbeat\n" {
				return fmt.Errorf("expected initial memory content, got %q", string(data))
			}
			return os.WriteFile(memoryPath, []byte("updated heartbeat\n"), 0o644)
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	waitForChannelWriteCount(t, hubChannel, 1)
	if err := <-done; err != nil {
		t.Fatalf("expected codex run success, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	stores, ok := updateResult(client.updates[0])["memoryStores"].([]any)
	if !ok || len(stores) != 1 {
		t.Fatalf("expected memoryStores result, got %#v", updateResult(client.updates[0]))
	}
	store, ok := stores[0].(map[string]any)
	if !ok || store["memoryRef"] != "ama://memories/memstore_1" {
		t.Fatalf("expected one memstore snapshot, got %#v", stores)
	}
	memories, ok := store["memories"].([]any)
	if !ok || len(memories) != 1 {
		t.Fatalf("expected one memory snapshot, got %#v", store)
	}
	memory, ok := memories[0].(map[string]any)
	if !ok || memory["path"] != "ak-maintainer-heartbeat.md" || memory["content"] != "updated heartbeat\n" {
		t.Fatalf("expected updated memory content, got %#v", memory)
	}
}

func TestRunOnceFailsCodexLeaseOnRuntimeAdapterFailure(t *testing.T) {
	workDir := t.TempDir()
	lease := codexSessionStartLease("fail")
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: lease, hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 7, "stderr": "bad failure"},
		err:    errors.New("codex runtime bridge failed"),
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for the initial user prompt and runtime.error to be relayed.
	waitForChannelWriteCount(t, hubChannel, 2)
	if err := <-done; err == nil || !strings.Contains(err.Error(), "codex runtime bridge failed") {
		t.Fatalf("expected codex bridge error after failed lease update, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	if len(client.events) != 0 {
		t.Fatalf("expected failed codex session to write runtime events on channel without HTTP uploads, got %#v", client.events)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "codex runtime bridge failed") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
}

func TestRuntimeSessionWorkspaceFailureFinalizesLease(t *testing.T) {
	work := codexSessionStartLease("prepare workspace")
	work.workItem.Payload["workspaceManifest"] = map[string]any{
		"root": "/workspace",
		"mounts": []map[string]any{{
			"type":      "memory",
			"memoryRef": "ama://memories/store_1",
			"mountPath": "/outside",
		}},
	}
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: work, hubChannel: hubChannel}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = &fakeRuntimeAdapter{}
	if err := daemon.RunOnce(context.Background()); err == nil {
		t.Fatal("expected workspace preparation failure")
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease, got %#v", client.updates)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "path must be under /workspace") {
		t.Fatalf("expected relayed runtime error for workspace failure, got %s", serializedEvents)
	}
}

func TestCodexSessionWorkspaceRejectsTraversalBeforeCreatingDirectory(t *testing.T) {
	workDir := t.TempDir()
	_, err := workspace.Open(workDir, "../outside-session")
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected session id validation error, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(workDir, "..", "outside-session")); !os.IsNotExist(statErr) {
		t.Fatalf("expected no directory outside workspace, stat error %v", statErr)
	}
	_, err = workspace.Open(workDir, "..")
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected parent segment validation error, got %v", err)
	}
}

func TestRunOnceLaunchesClaudeCodeRuntimeAndCompletesLease(t *testing.T) {
	// Claude-code is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: claudeCodeSessionStartLease(), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for the initial user prompt to be relayed.
	waitForChannelWriteCount(t, hubChannel, 2)
	if err := <-done; err != nil {
		t.Fatalf("expected claude runtime success, got %v", err)
	}
	if runtimeAdapter.request.Prompt != "Run Claude Code" {
		t.Fatalf("expected prompt to reach runtime adapter, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.Provider != "anthropic" || runtimeAdapter.request.Model != "claude-sonnet-4-6" {
		t.Fatalf("expected provider/model metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.RuntimeConfig["permissionMode"] != "acceptEdits" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	got := hubChannel.writtenEvents()
	want := []string{"message.completed", "message.completed"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("expected channel events %v, got %v", want, got)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, `"role":"user"`) || !strings.Contains(serializedEvents, `"text":"Run Claude Code"`) {
		t.Fatalf("expected initial prompt to be recorded as a user event, got %s", serializedEvents)
	}
}

func TestRunOnceCompletesExternalRuntimeWhenSuccessfulResultHasCompletionWarning(t *testing.T) {
	for name, result := range map[string]ama.JSON{
		"top-level-exit-code":     {"exitCode": 0},
		"nested-output-exit-code": {"output": ama.JSON{"exitCode": 0}},
	} {
		t.Run(name, func(t *testing.T) {
			// All runtimes relay over the per-runner hub channel. Seed it so the hub
			// connects immediately.
			hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
			client := &fakeAMAServer{lease: claudeCodeSessionStartLease(), hubChannel: hubChannel}
			runtimeAdapter := &fakeRuntimeAdapter{
				result: result,
				err:    errors.New("failed to get reader: failed to read frame header: EOF"),
			}
			daemon := testDaemon(client, &fakeAdapter{})
			daemon.RuntimeAdapter = runtimeAdapter

			done := make(chan error, 1)
			go func() { done <- daemon.RunOnce(context.Background()) }()
			// Wait for the prompt and default runtime message before asserting completion.
			waitForChannelWriteCount(t, hubChannel, 2)
			if err := <-done; err != nil {
				t.Fatalf("expected successful runtime result to complete despite warning, got %v", err)
			}
			if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
				t.Fatalf("expected completed lease update, got %#v", client.updates)
			}
			serializedResult := mustJSON(t, updateResult(client.updates[0]))
			if !strings.Contains(serializedResult, "completionWarning") {
				t.Fatalf("expected completion warning in result, got %s", serializedResult)
			}
		})
	}
}

func waitForChannelWriteCount(t *testing.T, channel *fakeSessionChannel, count int) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		if channel.writeCount() >= count {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for write %d, got %d", count, channel.writeCount())
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func waitForSandboxRequest(t *testing.T, adapter *fakeAdapter, done <-chan error) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		if adapter.requestCount() > 0 {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("run finished before sandbox request: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for sandbox request")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func waitForRuntimeRequest(t *testing.T, adapter *fakeRuntimeAdapter, done <-chan error) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		if adapter.lastRequest().SessionID != "" {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("run finished before runtime request: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for runtime request")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func TestStartRegistersRunnerAndSendsOfflineHeartbeatOnShutdown(t *testing.T) {
	client := &fakeAMAServer{runnerID: "runner_registered"}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	daemon.RunnerID = ""
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		count := len(client.heartbeats)
		client.mu.Unlock()
		if count > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for startup heartbeat")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	<-done
	if daemon.RunnerID != "runner_registered" {
		t.Fatalf("expected registered runner id, got %q", daemon.RunnerID)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if got := heartbeatState(client.heartbeats[len(client.heartbeats)-1]); got != "offline" {
		t.Fatalf("expected offline shutdown heartbeat, got %q", got)
	}
	build := version.Default()
	if got := heartbeatMetadata(client.heartbeats[0])["runnerVersion"]; got != build.Version {
		t.Fatalf("expected runner version heartbeat metadata %q, got %#v", build.Version, got)
	}
	if got := heartbeatMetadata(client.heartbeats[0])["commandAcknowledgement"]; got != true {
		t.Fatalf("expected command acknowledgement capability in heartbeat metadata, got %#v", got)
	}
}

// [spec: runners/heartbeat]
func TestStartProbesRuntimeUsageBeforeFirstHeartbeat(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	var callsMu sync.Mutex
	var includeUsageCalls []bool
	daemon.RuntimeCatalog = usageUnavailableRuntimeCatalog(&callsMu, &includeUsageCalls)
	daemon.Config.HeartbeatInterval = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()

	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		heartbeats := append([]ama.PutRunnerHeartbeatRequest(nil), client.heartbeats...)
		client.mu.Unlock()
		if len(heartbeats) > 0 {
			claude, found := lo.Find(heartbeatRuntimes(heartbeats[0]), func(entry ama.RunnerRuntime) bool {
				return entry.Runtime == "claude-code"
			})
			if !found || claude.State != "limited" {
				t.Fatalf("expected first heartbeat to report unavailable claude-code usage as limited, got %#v", claude)
			}
			break
		}
		select {
		case <-deadline:
			t.Fatal("timed out waiting for startup heartbeat")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancelled daemon, got %v", err)
	}

	callsMu.Lock()
	calls := append([]bool(nil), includeUsageCalls...)
	callsMu.Unlock()
	if !slices.Equal(calls, []bool{true, false}) {
		t.Fatalf("expected usage probe before runtime heartbeat inventory without an immediate collector repeat, got %v", calls)
	}
}

func TestStartFailsFastOnAMAServerSetupErrors(t *testing.T) {
	tests := []struct {
		name   string
		client *fakeAMAServer
		want   string
	}{
		{"configz", &fakeAMAServer{configErr: errors.New("bad config")}, "bad config"},
		{"create", &fakeAMAServer{createErr: errors.New("create failed")}, "create failed"},
		{"heartbeat", &fakeAMAServer{heartbeatErr: errors.New("heartbeat failed")}, "heartbeat failed"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			daemon := testDaemon(tc.client, &fakeAdapter{})
			daemon.RunnerID = ""
			err := daemon.Start(context.Background())
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
		})
	}
}

func TestStartFailsOnCleanupAndIncompatibleConfig(t *testing.T) {
	t.Run("cleanup stale", func(t *testing.T) {
		client := &fakeAMAServer{}
		daemon := testDaemon(client, &fakeAdapter{})
		sessionsPath := filepath.Join(daemon.Config.WorkDir, workspace.SessionsDirName)
		if err := os.WriteFile(sessionsPath, []byte("not a dir"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := daemon.Start(context.Background()); err == nil {
			t.Fatal("expected stale cleanup error")
		}
	})
	t.Run("incompatible config", func(t *testing.T) {
		config := fakePublicConfig()
		config.Service.Name = "Other"
		client := &fakeAMAServer{config: &config}
		daemon := testDaemon(client, &fakeAdapter{})
		if err := daemon.Start(context.Background()); err == nil {
			t.Fatal("expected incompatible config error")
		}
	})
}

func TestStartDoesNotPollForWorkItems(t *testing.T) {
	client := &fakeAMAServer{claimErr: errors.New("claim failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	time.Sleep(50 * time.Millisecond)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	client.mu.Lock()
	claims := client.claims
	client.mu.Unlock()
	if claims != 0 {
		t.Fatalf("expected runner Start not to poll work items, got %d polls", claims)
	}
}

func TestStartExitsAfterConsecutiveHeartbeatFailures(t *testing.T) {
	client := &fakeAMAServer{
		heartbeatErr:      errors.New("network down"),
		heartbeatErrAfter: 1,
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.HeartbeatInterval = time.Millisecond
	daemon.Config.ShutdownGraceInterval = time.Millisecond
	err := daemon.Start(context.Background())
	if err == nil || !strings.Contains(err.Error(), "runner heartbeat failed") {
		t.Fatalf("expected consecutive heartbeat failure, got %v", err)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.heartbeats) != 1 {
		t.Fatalf("expected only startup heartbeat to be accepted, got %#v", client.heartbeats)
	}
}

func TestStartReRegistersWhenHeartbeatReportsRunnerGone(t *testing.T) {
	client := &fakeAMAServer{
		runnerID:          "runner_recovered",
		heartbeatErrAfter: 1,
		heartbeatStatuses: []int{http.StatusNotFound},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.HeartbeatInterval = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		creates := len(client.creates)
		heartbeats := len(client.heartbeats)
		client.mu.Unlock()
		if creates > 0 && heartbeats >= 2 {
			cancel()
			break
		}
		select {
		case err := <-done:
			t.Fatalf("runner exited before re-registering: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for re-registration")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation after re-registration, got %v", err)
	}
	if daemon.RunnerID != "runner_recovered" {
		t.Fatalf("expected recovered runner id, got %q", daemon.RunnerID)
	}
}

func TestStartRunsPushedWorkAssignments(t *testing.T) {
	work := approvedLease()
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: work, hubChannel: hubChannel}
	adapter := &fakeAdapter{result: sandbox.ToolResult{Output: ama.JSON{"ok": true}}}
	daemon := testDaemon(client, adapter)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	hubChannel.push(ama.JSON{"type": "work.assigned", "lease": work.lease, "workItem": work.workItem})
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		updates := len(client.updates)
		client.mu.Unlock()
		if updates > 0 {
			cancel()
			break
		}
		select {
		case err := <-done:
			t.Fatalf("runner exited before completing assigned work: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for assigned work completion")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after assigned work, got %v", err)
	}
}

func TestStartRecoversActiveAssignedWork(t *testing.T) {
	work := approvedLease()
	client := &fakeAMAServer{lease: work, hubChannel: newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})}
	adapter := &fakeAdapter{result: sandbox.ToolResult{Output: ama.JSON{"ok": true}}}
	daemon := testDaemon(client, adapter)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Start(ctx)
	}()
	deadline := time.After(time.Second)
	for {
		client.mu.Lock()
		updates := len(client.updates)
		client.mu.Unlock()
		if updates > 0 {
			cancel()
			break
		}
		select {
		case err := <-done:
			t.Fatalf("runner exited before recovering assigned work: %v", err)
		case <-deadline:
			t.Fatal("timed out waiting for recovered work completion")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after recovered work, got %v", err)
	}
}

func TestRunAssignedWorkDeduplicatesActiveLease(t *testing.T) {
	work := approvedLease()
	client := &fakeAMAServer{lease: work}
	adapter := &fakeAdapter{waitForCancel: true}
	daemon := testDaemon(client, adapter)
	daemon.Config.MaxConcurrent = 2
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	daemon.runAssignedWork(ctx, work.lease, work.workItem)
	deadline := time.After(time.Second)
	for daemon.activeLoad() == 0 {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for assigned work to start")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	daemon.runAssignedWork(ctx, work.lease, work.workItem)
	time.Sleep(5 * time.Millisecond)
	if load := daemon.activeLoad(); load != 1 {
		t.Fatalf("expected duplicate lease to keep one active slot, got %d", load)
	}
	cancel()
}

func TestRunOnceReturnsWhenNoLeaseIsAvailable(t *testing.T) {
	client := &fakeAMAServer{}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected no-work run to succeed, got %v", err)
	}
	if len(client.updates) != 0 {
		t.Fatalf("expected no lease updates, got %#v", client.updates)
	}
}

func TestRunOnceCompletesAMASandboxSessionStart(t *testing.T) {
	if !host.SupportsAMARuntime() {
		t.Skip("AMA runtime is unavailable on this host")
	}
	lease := sessionStartLease()
	client := &fakeAMAServer{lease: lease, hubChannel: newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})}
	daemon := testDaemon(client, &fakeAdapter{})

	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected AMA runtime session start success, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
	result := updateResult(client.updates[0])
	if result["sessionId"] != "session_1" || result["runtime"] != "ama" || result["sandboxReady"] != true {
		t.Fatalf("expected sandbox-ready session result, got %#v", result)
	}
	if len(client.events) != 1 || client.events[0][0]["type"] != "runtime.started" {
		t.Fatalf("expected runtime.started event upload, got %#v", client.events)
	}
}

func TestRunOnceFailsAMASandboxSessionWhenAdapterMissing(t *testing.T) {
	if !host.SupportsAMARuntime() {
		t.Skip("AMA runtime is unavailable on this host")
	}
	lease := sessionStartLease()
	client := &fakeAMAServer{lease: lease, hubChannel: newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})}
	daemon := testDaemon(client, nil)

	if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "sandbox adapter") {
		t.Fatalf("expected missing sandbox adapter error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestRunOnceReturnsClaimErrors(t *testing.T) {
	client := &fakeAMAServer{claimErr: errors.New("claim failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "claim failed") {
		t.Fatalf("expected claim error, got %v", err)
	}
}

func TestDaemonSlotAccountingAndDefaults(t *testing.T) {
	daemon := testDaemon(&fakeAMAServer{}, &fakeAdapter{})
	daemon.Config.MaxConcurrent = 1
	if daemon.activeLoad() != 0 {
		t.Fatalf("expected no active leases, got %d", daemon.activeLoad())
	}
	if !daemon.tryAcquireLeaseSlot() {
		t.Fatal("expected first lease slot acquisition to succeed")
	}
	if daemon.activeLoad() != 1 {
		t.Fatalf("expected one active lease, got %d", daemon.activeLoad())
	}
	if daemon.tryAcquireLeaseSlot() {
		t.Fatal("expected second lease slot acquisition to fail at capacity")
	}
	daemon.releaseLeaseSlot()
	daemon.releaseLeaseSlot()
	if daemon.activeLoad() != 0 {
		t.Fatalf("expected release to floor at zero, got %d", daemon.activeLoad())
	}

	if daemon.identityStore().Config.WorkDir != daemon.Config.WorkDir {
		t.Fatal("expected default identity store to use daemon config")
	}
	if daemon.runtimes() == nil {
		t.Fatal("expected default runtime catalog")
	}
}

func TestRecoverRunnerIdentityClearsStoredRunnerAndRegistersFresh(t *testing.T) {
	client := &fakeAMAServer{runnerID: "runner_fresh"}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RunnerID = "runner_stale"
	store := daemon.identityStore()
	if err := store.StoreRunnerID("runner_stale"); err != nil {
		t.Fatal(err)
	}

	if err := daemon.recoverRunnerIdentity(context.Background()); err != nil {
		t.Fatalf("expected recovery success, got %v", err)
	}
	if daemon.RunnerID != "runner_fresh" {
		t.Fatalf("expected fresh runner id, got %q", daemon.RunnerID)
	}
	loaded, err := store.LoadRunnerID()
	if err != nil {
		t.Fatal(err)
	}
	if loaded != "runner_fresh" {
		t.Fatalf("expected stored runner id refreshed, got %q", loaded)
	}
}

func TestHeartbeatOrRecoverReRegistersWhenRunnerIsGone(t *testing.T) {
	client := &fakeAMAServer{
		heartbeatErr:    errors.New("runner gone"),
		heartbeatStatus: http.StatusNotFound,
		runnerID:        "runner_recovered",
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RunnerID = "runner_stale"
	err := daemon.heartbeatOrRecover(context.Background())
	if err == nil || !strings.Contains(err.Error(), "runner gone") {
		t.Fatalf("expected second heartbeat to still report configured gone error, got %v", err)
	}
	if daemon.RunnerID != "runner_recovered" {
		t.Fatalf("expected runner id recovered before retry, got %q", daemon.RunnerID)
	}
	if len(client.creates) != 1 {
		t.Fatalf("expected one re-registration, got %#v", client.creates)
	}
}

func TestNewDaemonWiresSDKClientAndAdapters(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_1", APIServer: "https://ama.example.test", AccessToken: "e2e-runner:test",
		TokenType: "Bearer",
	}); err != nil {
		t.Fatal(err)
	}
	config := runnerconfig.Config{
		APIServer:             "https://ama.example.test",
		CredentialPath:        credentialPath,
		WorkDir:               t.TempDir(),
		StateDir:              t.TempDir(),
		CommandTimeout:        time.Second,
		ShutdownGraceInterval: time.Millisecond,
	}
	daemon, err := New(config, version.Info{Name: "ama-runner", Version: "test"})
	if err != nil {
		t.Fatalf("expected daemon construction success, got %v", err)
	}
	if daemon.Client == nil || daemon.Channels == nil {
		t.Fatalf("expected daemon dependencies wired, got %#v", daemon)
	}
	if (daemon.Adapter != nil) != host.SupportsAMARuntime() {
		t.Fatalf("expected daemon adapter availability to match host support, got %T", daemon.Adapter)
	}
	if daemon.Build.Version != "test" {
		t.Fatalf("expected build info retained, got %#v", daemon.Build)
	}
}

func TestRunnerRuntimeUsageMapsWindows(t *testing.T) {
	usage := runnerRuntimeUsage([]runtime.RuntimeUsage{{
		Runtime: "claude-code",
		Windows: []runtime.UsageWindow{{
			Label:       "5h",
			Utilization: 0.42,
			ResetsAt:    "2026-01-02T03:04:05Z",
		}},
	}})
	if len(usage) != 1 || usage[0].Runtime != "claude-code" || len(usage[0].Windows) != 1 {
		t.Fatalf("unexpected usage mapping: %#v", usage)
	}
	window := usage[0].Windows[0]
	if window.Label != "5h" || window.Utilization != 0.42 || window.ResetsAt != "2026-01-02T03:04:05Z" {
		t.Fatalf("unexpected usage window mapping: %#v", window)
	}
}

func TestRunOnceMarksExecutorFailureAsFailedLease(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease()}
	adapter := &fakeAdapter{
		result: sandbox.ToolResult{Output: map[string]any{"stdout": "", "stderr": "no", "exitCode": 2}},
		err:    errors.New("command failed"),
	}
	daemon := testDaemon(client, adapter)
	if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "command failed") {
		t.Fatalf("expected command failed error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed update, got %#v", client.updates)
	}
}

func TestRunOnceReturnsEventUploadErrors(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease(), eventErr: errors.New("event failed")}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "event failed") {
		t.Fatalf("expected event error, got %v", err)
	}
}

func TestRunOnceFailsFastOnUnapprovedWorkAfterMarkingLeaseFailed(t *testing.T) {
	lease := approvedLease()
	lease.workItem.Payload["approved"] = false
	client := &fakeAMAServer{lease: lease}
	adapter := &fakeAdapter{}
	daemon := testDaemon(client, adapter)
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected unapproved work error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestRunOnceFailsLeaseWhenRuntimeRequirementDoesNotMatch(t *testing.T) {
	lease := sessionStartLease()
	lease.workItem.Payload["runtimeRequirement"] = ama.JSON{"runtime": "missing-runtime", "model": "model"}
	client := &fakeAMAServer{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "runtime requirement") {
		t.Fatalf("expected runtime requirement error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	message, _ := updateError(client.updates[0])["message"].(string)
	if !strings.Contains(message, "runtime requirement") {
		t.Fatalf("expected runtime requirement error, got %#v", updateError(client.updates[0]))
	}
}

func TestLeaseRenewalFailureCancelsLocalWorkWithoutCompletionRetry(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease(), updateErr: errors.New("lease lost")}
	adapter := &fakeAdapter{waitForCancel: true}
	daemon := testDaemon(client, adapter)
	daemon.Config.RenewInterval = time.Millisecond
	err := daemon.RunOnce(context.Background())
	if err == nil || !strings.Contains(err.Error(), "runner lease renewal failed") {
		t.Fatalf("expected renew failure, got %v", err)
	}
	if !adapter.cancelled.Load() {
		t.Fatal("expected renew failure to cancel adapter context")
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "active" {
		t.Fatalf("expected only renew update, got %#v", client.updates)
	}
}

func TestContextCancellationMarksLeaseCancelled(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease()}
	adapter := &fakeAdapter{waitForCancel: true}
	daemon := testDaemon(client, adapter)
	daemon.Config.RenewInterval = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.RunOnce(ctx)
	}()
	waitForSandboxRequest(t, adapter, done)
	cancel()
	err := <-done
	if err != nil {
		t.Fatalf("expected cancelled lease update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "cancelled" {
		t.Fatalf("expected cancelled update, got %#v", client.updates)
	}
}

func TestDaemonStartReturnsWorkDirError(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	workDirFile := filepath.Join(t.TempDir(), "work-file")
	if err := os.WriteFile(workDirFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	daemon.Config.WorkDir = workDirFile
	if err := daemon.Start(context.Background()); err == nil {
		t.Fatal("expected start to fail when work dir is a file")
	}
}

func TestDaemonRuntimeCatalogDefaultsAndUsageRefresh(t *testing.T) {
	calls := 0
	daemon := Daemon{Config: runnerconfig.Config{}}
	daemon.RuntimeCatalog = &runtime.Inventory{
		Load: func(_ context.Context, includeUsage bool) (*runtime.InventorySnapshot, error) {
			calls++
			if !includeUsage {
				t.Fatal("expected usage refresh")
			}
			return &runtime.InventorySnapshot{Runtimes: []runtime.InventoryRuntime{{
				Runtime: "codex",
				UsageWindows: []runtime.UsageWindow{{
					Label:       "1h",
					Utilization: 10,
				}},
			}}}, nil
		},
	}
	daemon.refreshRuntimeUsage(context.Background())
	if calls != 1 {
		t.Fatalf("expected usage refresh call, got %d", calls)
	}
	if usage := daemon.getRuntimeUsage(); len(usage) != 1 || usage[0].Runtime != "codex" {
		t.Fatalf("unexpected runtime usage %#v", usage)
	}

	defaulted := Daemon{Config: runnerconfig.Config{}}
	if defaulted.runtimes() == nil || defaulted.RuntimeCatalog == nil {
		t.Fatal("expected runtime catalog to be initialized")
	}
}

func TestDaemonIdentityAndRelayHelpers(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	store := IdentityStore{Config: daemon.Config}
	daemon.IdentityStore = &store
	if got := daemon.identityStore().Config.WorkDir; got != daemon.Config.WorkDir {
		t.Fatalf("expected injected identity store, got %#v", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	daemon.startRelay(ctx)
	first := daemon.relay
	daemon.startRelay(ctx)
	if first == nil || daemon.relay != first {
		t.Fatal("expected startRelay to be idempotent")
	}
}

func TestDaemonIdentityErrorPaths(t *testing.T) {
	t.Run("stored runner id", func(t *testing.T) {
		client := &fakeAMAServer{}
		daemon := testDaemon(client, &fakeAdapter{})
		store := daemon.identityStore()
		if err := store.StoreRunnerID("runner_stored"); err != nil {
			t.Fatal(err)
		}
		daemon.RunnerID = ""
		if err := daemon.ensureRunnerID(context.Background()); err != nil {
			t.Fatalf("expected stored runner id, got %v", err)
		}
		if daemon.RunnerID != "runner_stored" || len(client.creates) != 0 {
			t.Fatalf("unexpected runner recovery runnerID=%q creates=%d", daemon.RunnerID, len(client.creates))
		}
	})
	t.Run("store runner id failure", func(t *testing.T) {
		client := &fakeAMAServer{runnerID: "runner_new"}
		daemon := testDaemon(client, &fakeAdapter{})
		stateFile := filepath.Join(t.TempDir(), "state-file")
		if err := os.WriteFile(stateFile, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		daemon.Config.StateDir = stateFile
		daemon.RunnerID = ""
		if err := daemon.ensureRunnerID(context.Background()); err == nil {
			t.Fatal("expected store runner id failure")
		}
	})
	t.Run("recover clear failure", func(t *testing.T) {
		daemon := testDaemon(&fakeAMAServer{}, &fakeAdapter{})
		stateFile := filepath.Join(t.TempDir(), "state-file")
		if err := os.WriteFile(stateFile, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		daemon.Config.StateDir = stateFile
		if err := daemon.recoverRunnerIdentity(context.Background()); err == nil {
			t.Fatal("expected recover clear failure")
		}
	})
	t.Run("heartbeat machine id failure", func(t *testing.T) {
		daemon := testDaemon(&fakeAMAServer{}, &fakeAdapter{})
		stateFile := filepath.Join(t.TempDir(), "state-file")
		if err := os.WriteFile(stateFile, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		daemon.Config.StateDir = stateFile
		if err := daemon.heartbeat(context.Background()); err == nil {
			t.Fatal("expected heartbeat identity failure")
		}
	})
}

func TestRunOnceSkipsClaimWhenAtCapacity(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease()}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.Config.MaxConcurrent = 0
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected capacity skip, got %v", err)
	}
	if client.claims != 0 {
		t.Fatalf("expected no claim at capacity, got %d", client.claims)
	}
}

func TestRunOnceFailsBeforeClaimOnIdentityOrHeartbeatError(t *testing.T) {
	t.Run("identity", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease()}
		daemon := testDaemon(client, &fakeAdapter{})
		stateFile := filepath.Join(t.TempDir(), "state-file")
		if err := os.WriteFile(stateFile, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		daemon.Config.StateDir = stateFile
		daemon.RunnerID = ""
		if err := daemon.RunOnce(context.Background()); err == nil {
			t.Fatal("expected identity error")
		}
		if client.claims != 0 {
			t.Fatalf("expected no claims after identity error, got %d", client.claims)
		}
	})
	t.Run("heartbeat", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease(), heartbeatErr: errors.New("heartbeat down")}
		daemon := testDaemon(client, &fakeAdapter{})
		if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "heartbeat down") {
			t.Fatalf("expected heartbeat error, got %v", err)
		}
		if client.claims != 0 {
			t.Fatalf("expected no claims after heartbeat error, got %d", client.claims)
		}
	})
}

func TestRunAssignedWorkSkipsWhenAtCapacity(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease()}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.activeLeases = daemon.Config.MaxConcurrent
	daemon.runAssignedWork(context.Background(), client.lease.lease, client.lease.workItem)
	time.Sleep(5 * time.Millisecond)
	if len(client.updates) != 0 {
		t.Fatalf("expected no lease updates when at capacity, got %#v", client.updates)
	}
}

func TestClaimLeaseHandlesRaceAndCreateErrors(t *testing.T) {
	t.Run("race skips candidate", func(t *testing.T) {
		client := &fakeAMAServer{
			lease:          approvedLease(),
			leaseCreateErr: errors.New("already claimed"),
			leaseStatus:    http.StatusConflict,
		}
		daemon := testDaemon(client, &fakeAdapter{})
		if err := daemon.RunOnce(context.Background()); err != nil {
			t.Fatalf("expected claim race to be skipped, got %v", err)
		}
		if len(client.updates) != 0 {
			t.Fatalf("expected no updates after race skip, got %#v", client.updates)
		}
	})
	t.Run("create error fails", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease(), leaseCreateErr: errors.New("database down")}
		daemon := testDaemon(client, &fakeAdapter{})
		if err := daemon.RunOnce(context.Background()); err == nil {
			t.Fatal("expected lease create error")
		}
	})
}

func TestFinalizeRuntimeSessionBranches(t *testing.T) {
	t.Run("successful output with warning completes", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease()}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		err := worker.finalizeRuntimeSession(
			context.Background(),
			context.Background(),
			client.lease.lease,
			nil,
			runtime.Result{Output: ama.JSON{"exitCode": 0}, Err: errors.New("late warning")},
			func(ama.JSON) {},
		)
		if err != nil {
			t.Fatalf("expected successful warning completion, got %v", err)
		}
		if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
			t.Fatalf("expected completed lease, got %#v", client.updates)
		}
		if updateResult(client.updates[0])["completionWarning"] == nil {
			t.Fatalf("expected completion warning in result, got %#v", updateResult(client.updates[0]))
		}
	})
	t.Run("timeout fails and writes runtime error", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease()}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		var runtimeError ama.JSON
		err := worker.finalizeRuntimeSession(
			context.Background(),
			context.Background(),
			client.lease.lease,
			nil,
			runtime.Result{Output: ama.JSON{"exitCode": 1}, Err: errors.New("deadline"), TimedOut: true},
			func(payload ama.JSON) { runtimeError = payload },
		)
		if err == nil || !strings.Contains(err.Error(), "max duration") {
			t.Fatalf("expected timeout error, got %v", err)
		}
		if runtimeError["code"] != "session_timeout" {
			t.Fatalf("expected timeout runtime error, got %#v", runtimeError)
		}
		if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
			t.Fatalf("expected failed lease, got %#v", client.updates)
		}
	})
	t.Run("request cancellation interrupts", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease()}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		tokens := &resumeTokenBox{}
		tokens.Set("resume_1")
		err := worker.finalizeRuntimeSession(
			context.Background(),
			ctx,
			client.lease.lease,
			tokens,
			runtime.Result{Err: context.Canceled},
			func(ama.JSON) {},
		)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation, got %v", err)
		}
		if len(client.updates) != 1 || leaseState(client.updates[0]) != "interrupted" {
			t.Fatalf("expected interrupted lease, got %#v", client.updates)
		}
		if client.updates[0].ResumeToken == nil || *client.updates[0].ResumeToken != "resume_1" {
			t.Fatalf("expected resume token on interrupt, got %#v", client.updates[0])
		}
	})
}

func testDaemon(client *fakeAMAServer, adapter sandbox.SandboxAdapter) Daemon {
	workDir, err := os.MkdirTemp("", "ama-runner-test-*")
	if err != nil {
		panic(err)
	}
	return Daemon{
		Config: runnerconfig.Config{
			StateDir:              workDir,
			WorkDir:               workDir,
			MaxConcurrent:         1,
			HeartbeatInterval:     time.Second,
			LeaseDurationSeconds:  60,
			RenewInterval:         time.Hour,
			CommandTimeout:        time.Second,
			ShutdownGraceInterval: time.Millisecond,
		},
		Client:   client.sdkClient(),
		Channels: client,
		Adapter:  adapter,
		RuntimeCatalog: runtimesFor(
			runtimeEntry("claude-code", true, []string{"claude-sonnet-4-6"}, nil, "ready", "", "ready"),
			runtimeEntry("codex", true, []string{"gpt-5.3-codex"}, nil, "ready", "", "ready"),
			runtimeEntry("copilot", true, []string{"copilot-cli"}, nil, "ready", "", "ready"),
		),
		RunnerID: "runner_1",
	}
}

func runtimesFor(entries ...runtime.InventoryRuntime) *runtime.Inventory {
	return &runtime.Inventory{
		Load: func(context.Context, bool) (*runtime.InventorySnapshot, error) {
			return &runtime.InventorySnapshot{Runtimes: append([]runtime.InventoryRuntime(nil), entries...)}, nil
		},
	}
}

func usageUnavailableRuntimeCatalog(callsMu *sync.Mutex, includeUsageCalls *[]bool) *runtime.Inventory {
	entry := runtimeEntry(
		"claude-code",
		true,
		[]string{"claude-sonnet-4-6"},
		[]string{"claude-sonnet-4-6"},
		"ready",
		"2.1.185",
		"ready",
	)
	return &runtime.Inventory{
		Load: func(_ context.Context, includeUsage bool) (*runtime.InventorySnapshot, error) {
			callsMu.Lock()
			*includeUsageCalls = append(*includeUsageCalls, includeUsage)
			callsMu.Unlock()
			snapshotEntry := entry
			if includeUsage {
				snapshotEntry.LimitedDetail = "Claude Code quota usage unavailable; scheduling paused until the usage probe succeeds"
			}
			return &runtime.InventorySnapshot{Runtimes: []runtime.InventoryRuntime{snapshotEntry}}, nil
		},
	}
}

func runtimeEntry(name string, installed bool, fallbackModels, models []string, status, version, detail string) runtime.InventoryRuntime {
	return runtime.InventoryRuntime{
		Runtime:        name,
		Binary:         name,
		Installed:      installed,
		FallbackModels: fallbackModels,
		Models:         models,
		Status:         status,
		Version:        version,
		Detail:         detail,
	}
}

func approvedLease() *fakeWork {
	return &fakeWork{
		lease: &ama.Lease{
			Id:         "lease_1",
			WorkItemId: "work_1",
			RunnerId:   "runner_1",
			State:      ama.LeaseStateActive,
		},
		workItem: &ama.WorkItem{
			Id:        "work_1",
			SessionId: lo.ToPtr("session_1"),
			Type:      "tool.execute",
			State:     ama.WorkItemStateLeased,
			Payload: ama.JSON{
				"protocol":   "ama-runner-work",
				"type":       "tool.execute",
				"approved":   true,
				"toolCallId": "call_1",
				"toolName":   "bash",
				"input":      map[string]any{"command": "printf ok"},
			},
		},
	}
}

func sessionStartLease() *fakeWork {
	return &fakeWork{
		lease: &ama.Lease{
			Id:         "lease_1",
			WorkItemId: "work_1",
			RunnerId:   "runner_1",
			State:      ama.LeaseStateActive,
		},
		workItem: &ama.WorkItem{
			Id:        "work_1",
			SessionId: lo.ToPtr("session_1"),
			Type:      "session.start",
			State:     ama.WorkItemStateLeased,
			Payload: ama.JSON{
				"protocol":           "ama-runner-work",
				"type":               "session.start",
				"sessionId":          "session_1",
				"hostingMode":        "self_hosted",
				"runtime":            "ama",
				"runtimeConfig":      map[string]any{},
				"provider":           "workers-ai",
				"model":              "@cf/moonshotai/kimi-k2.6",
				"runtimeDriver":      "ama-self-hosted",
				"runtimeRequirement": ama.JSON{"runtime": amaRuntimeCapability},
			},
		},
	}
}

func codexSessionStartLease(prompt string) *fakeWork {
	work := sessionStartLease()
	work.workItem.Payload["runtime"] = "codex"
	work.workItem.Payload["runtimeConfig"] = map[string]any{"model": "gpt-5.3-codex", "sandboxMode": "workspace-write"}
	work.workItem.Payload["provider"] = "provider_codex"
	work.workItem.Payload["model"] = "gpt-5.3-codex"
	work.workItem.Payload["runtimeDriver"] = "codex-self-hosted"
	work.workItem.Payload["runtimeRequirement"] = ama.JSON{"runtime": "codex", "model": "gpt-5.3-codex"}
	work.workItem.Payload["prompt"] = prompt
	return work
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func leaseState(update ama.UpdateLeaseRequest) string {
	if update.State == nil {
		return ""
	}
	return string(*update.State)
}

func updateResult(update ama.UpdateLeaseRequest) ama.JSON {
	if update.Result == nil {
		return nil
	}
	return *update.Result
}

func updateError(update ama.UpdateLeaseRequest) ama.JSON {
	if update.Error == nil {
		return nil
	}
	return *update.Error
}

func createMetadata(request ama.CreateRunnerRequest) ama.JSON {
	if request.Metadata == nil {
		return nil
	}
	return *request.Metadata
}

func heartbeatMetadata(request ama.PutRunnerHeartbeatRequest) ama.JSON {
	if request.Metadata == nil {
		return nil
	}
	return *request.Metadata
}

func heartbeatState(request ama.PutRunnerHeartbeatRequest) string {
	if request.State == nil {
		return ""
	}
	return string(*request.State)
}

func heartbeatRuntimes(request ama.PutRunnerHeartbeatRequest) []ama.RunnerRuntime {
	if request.Runtimes == nil {
		return nil
	}
	return *request.Runtimes
}

func claudeCodeSessionStartLease() *fakeWork {
	work := externalRuntimeSessionStartLease("claude-code", "anthropic", "claude-sonnet-4-6", map[string]any{"permissionMode": "acceptEdits"})
	work.workItem.Payload["prompt"] = "Run Claude Code"
	return work
}

func externalRuntimeSessionStartLease(runtimeName string, provider string, model string, runtimeConfig any) *fakeWork {
	work := sessionStartLease()
	work.workItem.Payload["runtime"] = runtimeName
	if config, ok := runtimeConfig.(map[string]any); ok {
		work.workItem.Payload["runtimeConfig"] = config
	} else {
		work.workItem.Payload["runtimeConfig"] = map[string]any{"mode": runtimeConfig}
	}
	work.workItem.Payload["provider"] = provider
	work.workItem.Payload["model"] = model
	work.workItem.Payload["runtimeDriver"] = runtimeName + "-self-hosted"
	work.workItem.Payload["prompt"] = "Run CLI-backed runtime"
	work.workItem.Payload["runtimeRequirement"] = ama.JSON{"runtime": runtimeName, "model": model}
	return work
}

func TestHeartbeatRefreshesRuntimesFromBridge(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeCatalog = runtimesFor(runtimeEntry("codex", true, []string{"gpt-5.3-codex"}, nil, "ready", "", "ready"))
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	first := heartbeatRuntimes(client.heartbeats[0])
	if !lo.ContainsBy(first, func(entry ama.RunnerRuntime) bool { return entry.Runtime == "codex" }) {
		t.Fatalf("expected codex runtime, got %v", first)
	}
	if lo.ContainsBy(first, func(entry ama.RunnerRuntime) bool {
		return entry.Runtime == "claude-code" || entry.Runtime == "copilot"
	}) {
		t.Fatalf("expected missing CLIs to be excluded, got %v", first)
	}

	daemon.RuntimeCatalog = runtimesFor(
		runtimeEntry("codex", true, []string{"gpt-5.3-codex"}, nil, "ready", "", "ready"),
		runtimeEntry("claude-code", true, []string{"claude-sonnet-4-6"}, nil, "ready", "", "ready"),
	)
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	second := heartbeatRuntimes(client.heartbeats[1])
	if !lo.ContainsBy(second, func(entry ama.RunnerRuntime) bool { return entry.Runtime == "claude-code" }) {
		t.Fatalf("expected claude-code runtime after installing the CLI, got %v", second)
	}
}

func TestHeartbeatAdvertisesEnumeratedBridgeModels(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeCatalog = runtimesFor(runtimeEntry("codex", true, []string{"gpt-5.3-codex"}, []string{"gpt-5.3-codex", "gpt-5.3-codex-mini"}, "ready", "0.42.0", "host CLI enumerated 2 models"))
	for range 2 {
		if err := daemon.heartbeat(context.Background()); err != nil {
			t.Fatalf("expected heartbeat success, got %v", err)
		}
	}
	for _, heartbeat := range client.heartbeats {
		inventory := heartbeatRuntimes(heartbeat)
		codexInventory, found := lo.Find(inventory, func(entry ama.RunnerRuntime) bool { return entry.Runtime == "codex" })
		if !found || !slices.Equal(codexInventory.Models, []string{"gpt-5.3-codex", "gpt-5.3-codex-mini"}) {
			t.Fatalf("expected enumerated codex models in reported runtimes, got %#v", inventory)
		}
	}
}

func TestHeartbeatReportsRuntimeCatalogWithStatusAndDiagnostics(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeCatalog = runtimesFor(
		runtimeEntry("codex", true, []string{"gpt-5.3-codex"}, []string{"gpt-5.3-codex"}, "ready", "0.42.0", "host CLI enumerated 1 models"),
		runtimeEntry("claude-code", true, []string{"claude-sonnet-4-6"}, nil, "unauthenticated", "", "host CLI exposed no models; authenticate the runtime CLI"),
		runtimeEntry("copilot", false, []string{"copilot-cli"}, nil, "missing", "", "copilot CLI not found on PATH"),
	)
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	inventory := heartbeatRuntimes(client.heartbeats[0])
	byRuntime := map[string]ama.RunnerRuntime{}
	for _, entry := range inventory {
		byRuntime[entry.Runtime] = entry
	}
	if host.SupportsAMARuntime() {
		if got := byRuntime["ama"]; got.State != "ready" || stringValue(got.Detail) == "" {
			t.Fatalf("expected ready ama runtime declaration, got %#v", got)
		}
	} else if _, ok := byRuntime["ama"]; ok {
		t.Fatal("expected host without AMA support to omit its inventory entry")
	}
	if got := byRuntime["codex"]; got.State != "ready" || stringValue(got.Version) != "0.42.0" || stringValue(got.Detail) == "" {
		t.Fatalf("expected ready codex inventory with version and detail, got %#v", got)
	}
	if got := byRuntime["claude-code"]; got.State != "unauthenticated" || stringValue(got.Detail) == "" {
		t.Fatalf("expected unauthenticated claude-code inventory, got %#v", got)
	}
	if got := byRuntime["copilot"]; got.State != "missing" || stringValue(got.Detail) == "" {
		t.Fatalf("expected missing copilot inventory, got %#v", got)
	}
	if data := mustJSON(t, inventory); strings.Contains(data, "raw-secret") {
		t.Fatalf("expected inventory to carry only safe metadata, got %s", data)
	}
}

func TestHeartbeatMarksClaudeCodeLimitedWhenUsageProbeUnavailable(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeCatalog = runtimesFor(runtimeEntry("claude-code", true, []string{"claude-sonnet-4-6"}, []string{"claude-sonnet-4-6"}, "ready", "2.1.185", "host CLI enumerated 1 models"))
	usageUnavailableDetail := "Claude Code quota usage unavailable; scheduling paused until the usage probe succeeds"
	daemon.setRuntimeUsageSnapshot(&runtime.UsageSnapshot{
		Limited: map[string]string{"claude-code": usageUnavailableDetail},
	})

	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}

	inventory := heartbeatRuntimes(client.heartbeats[0])
	byRuntime := map[string]ama.RunnerRuntime{}
	for _, entry := range inventory {
		byRuntime[entry.Runtime] = entry
	}
	if got := byRuntime["claude-code"]; got.State != "limited" || stringValue(got.Detail) != usageUnavailableDetail {
		t.Fatalf("expected usage-unavailable claude-code to be limited, got %#v", got)
	}
	if !lo.ContainsBy(heartbeatRuntimes(client.heartbeats[0]), func(entry ama.RunnerRuntime) bool { return entry.Runtime == "claude-code" }) {
		t.Fatalf("expected limited runtime to remain visible for diagnostics and recovery, got %v", heartbeatRuntimes(client.heartbeats[0]))
	}
}

func TestHeartbeatAdvertisesOnlyHostRuntimesWhenNoCLIRuntimesAreInstalled(t *testing.T) {
	client := &fakeAMAServer{}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeCatalog = runtimesFor()
	if err := daemon.heartbeat(context.Background()); err != nil {
		t.Fatalf("expected heartbeat success, got %v", err)
	}
	got := heartbeatRuntimes(client.heartbeats[0])
	var want []string
	if host.SupportsAMARuntime() {
		want = []string{amaRuntimeCapability}
	}
	gotNames := lo.Map(got, func(entry ama.RunnerRuntime, _ int) string { return entry.Runtime })
	if strings.Join(gotNames, ",") != strings.Join(want, ",") {
		t.Fatalf("expected only host runtimes %v, got %v", want, got)
	}
}

func TestRunOnceFailsLeaseWhenRuntimeCLIIsMissing(t *testing.T) {
	lease := codexSessionStartLease("build")
	client := &fakeAMAServer{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeCatalog = runtimesFor(
		runtimeEntry("claude-code", true, []string{"claude-sonnet-4-6"}, nil, "ready", "", "ready"),
		runtimeEntry("copilot", true, []string{"copilot-cli"}, nil, "ready", "", "ready"),
	)
	if err := daemon.RunOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "runtime requirement") {
		t.Fatalf("expected runtime requirement error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
	message, _ := updateError(client.updates[0])["message"].(string)
	if !strings.Contains(message, "runtime requirement") {
		t.Fatalf("expected runtime requirement error for missing codex CLI, got %#v", updateError(client.updates[0]))
	}
}

func TestRunOnceFailsLeaseWhenSessionExceedsMaxDuration(t *testing.T) {
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: codexSessionStartLease("runaway"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{waitForCancel: true}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.MaxSessionDuration = 20 * time.Millisecond

	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for the initial user prompt and runtime.error to be relayed.
	waitForChannelWriteCount(t, hubChannel, 2)
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "exceeded max duration") {
		t.Fatalf("expected session timeout error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed (not interrupted) lease update, got %#v", client.updates)
	}
	message, _ := updateError(client.updates[0])["message"].(string)
	if !strings.Contains(message, "session exceeded max duration") {
		t.Fatalf("expected explicit timeout message, got %#v", updateError(client.updates[0]))
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "session_timeout") {
		t.Fatalf("expected session_timeout runtime.error event, got %s", serializedEvents)
	}
}

func TestRunOnceDisablesSessionDeadlineWhenMaxDurationIsZero(t *testing.T) {
	// Codex is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: codexSessionStartLease("build"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.MaxSessionDuration = 0
	if err := daemon.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected run success with disabled session deadline, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "completed" {
		t.Fatalf("expected completed lease update, got %#v", client.updates)
	}
}

func TestLeasePollDelayBacksOffAndCaps(t *testing.T) {
	base := 2 * time.Second
	if got := leasePollDelay(base, 0); got != base {
		t.Fatalf("no failures should keep the base delay, got %v", got)
	}
	if got := leasePollDelay(base, 1); got != 4*time.Second {
		t.Fatalf("one failure should double the delay, got %v", got)
	}
	if got := leasePollDelay(base, 3); got != 16*time.Second {
		t.Fatalf("three failures should give 16s, got %v", got)
	}
	if got := leasePollDelay(base, 50); got != leaseClaimBackoffCap {
		t.Fatalf("many failures should cap at %v, got %v", leaseClaimBackoffCap, got)
	}
	if got := leasePollDelay(time.Hour, 2); got != leaseClaimBackoffCap {
		t.Fatalf("overflowing delay should cap at %v, got %v", leaseClaimBackoffCap, got)
	}
}

func TestRunOnceDispatchesCopilotRuntimeThroughAdapter(t *testing.T) {
	workDir := t.TempDir()
	// Copilot is a CLI relay runtime: events flow over the per-runner hub channel,
	// not a per-lease channel. Seed the hub channel so the hub connects immediately.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: copilotSessionStartLease("copilot prompt"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 0, "providerThreadId": "copilot_thread_1"},
		events: []RuntimeEvent{
			runtimeEvent("message.completed", ama.JSON{"message": ama.JSON{"role": "assistant", "content": []any{ama.JSON{"type": "text", "text": "copilot prompt ok"}}}}),
			runtimeToolCallMessage("copilot_tool_1", "bash", ama.JSON{"command": "printf ok"}),
			runtimeToolResultMessage("copilot_tool_1", ama.JSON{"stdout": "ok", "stderr": "", "exitCode": 0}),
			runtimeEvent("usage.recorded", ama.JSON{"provider": "provider_copilot", "model": "copilot-cli", "inputTokens": 4, "outputTokens": 5, "totalTokens": 9}),
		},
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	daemon.Config.WorkDir = workDir
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for at least one event to be relayed over the hub channel.
	waitForChannelWriteCount(t, hubChannel, 1)
	if err := <-done; err != nil {
		t.Fatalf("expected copilot run success, got %v", err)
	}
	if runtimeAdapter.request.Runtime != "copilot" ||
		runtimeAdapter.request.Prompt != "copilot prompt" ||
		runtimeAdapter.request.Provider != "provider_copilot" ||
		runtimeAdapter.request.Model != "copilot-cli" {
		t.Fatalf("expected copilot runtime request metadata, got %#v", runtimeAdapter.request)
	}
	if runtimeAdapter.request.RuntimeConfig["approvalMode"] != "auto" {
		t.Fatalf("expected runtime config to reach adapter, got %#v", runtimeAdapter.request.RuntimeConfig)
	}
	if len(client.updates) == 0 || leaseState(client.updates[len(client.updates)-1]) != "completed" {
		t.Fatalf("expected completed copilot lease update, got %#v", client.updates)
	}
	if updateResult(client.updates[len(client.updates)-1])["providerThreadId"] != "copilot_thread_1" {
		t.Fatalf("expected adapter result to complete lease, got %#v", updateResult(client.updates[len(client.updates)-1]))
	}
	gotTypes := hubChannel.writtenEvents()
	for _, want := range []string{
		"message.completed",
		"usage.recorded",
	} {
		if !lo.Contains(gotTypes, want) {
			t.Fatalf("expected channel event %s in %v", want, gotTypes)
		}
	}
	storedEvents, err := runnersession.ReadEventLog(runnersession.EventLogPath(filepath.Join(workDir, "sessions", "session_1")))
	if err != nil {
		t.Fatalf("expected stored session events, got %v", err)
	}
	serializedStoredEvents := mustJSON(t, storedEvents)
	if !strings.Contains(serializedStoredEvents, `"role":"user"`) ||
		!strings.Contains(serializedStoredEvents, `"text":"copilot prompt"`) {
		t.Fatalf("expected initial prompt to be durable in runner log, got %s", serializedStoredEvents)
	}
	for _, message := range hubChannel.writtenMessages() {
		record, _ := message["record"].(map[string]any)
		if message["type"] != "runner.event" || record["id"] == "" {
			t.Fatalf("expected copilot event to use runner event envelope, got %#v", message)
		}
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	for _, want := range []string{
		"copilot prompt ok",
		"provider_copilot",
		"copilot-cli",
	} {
		if !strings.Contains(serializedEvents, want) {
			t.Fatalf("expected %q in copilot events, got %s", want, serializedEvents)
		}
	}
	if strings.Contains(serializedEvents, "AMA_TOKEN") || strings.Contains(serializedEvents, "secret://providers") {
		t.Fatalf("expected safe copilot events, got %s", serializedEvents)
	}
}

func TestRunOnceFailsCopilotLeaseOnRuntimeAdapterFailure(t *testing.T) {
	// Copilot is a CLI relay runtime: events flow over the per-runner hub channel.
	hubChannel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
	client := &fakeAMAServer{lease: copilotSessionStartLease("fail"), hubChannel: hubChannel}
	runtimeAdapter := &fakeRuntimeAdapter{
		result: ama.JSON{"exitCode": 7, "stderr": "bad failure"},
		err:    errors.New("copilot runtime bridge failed"),
	}
	daemon := testDaemon(client, &fakeAdapter{})
	daemon.RuntimeAdapter = runtimeAdapter
	done := make(chan error, 1)
	go func() { done <- daemon.RunOnce(context.Background()) }()
	// Wait for the initial user prompt and runtime.error to be relayed.
	waitForChannelWriteCount(t, hubChannel, 2)
	err := <-done
	if err == nil || !strings.Contains(err.Error(), "copilot runtime bridge failed") {
		t.Fatalf("expected copilot failure to be returned, got %v", err)
	}
	if len(client.updates) == 0 || leaseState(client.updates[len(client.updates)-1]) != "failed" {
		t.Fatalf("expected failed copilot lease update, got %#v", client.updates)
	}
	serializedEvents := mustJSON(t, hubChannel.writtenMessages())
	if !strings.Contains(serializedEvents, "runtime.error") || !strings.Contains(serializedEvents, "copilot runtime bridge failed") {
		t.Fatalf("expected runtime error events, got %s", serializedEvents)
	}
	failedUpdate := client.updates[len(client.updates)-1]
	if !strings.Contains(mustJSON(t, failedUpdate.Result), `"exitCode":7`) {
		t.Fatalf("expected failed lease result to include exit code, got %#v", failedUpdate.Result)
	}
}

func copilotSessionStartLease(prompt string) *fakeWork {
	lease := sessionStartLease()
	lease.workItem.Payload["runtime"] = "copilot"
	lease.workItem.Payload["runtimeConfig"] = map[string]any{"approvalMode": "auto"}
	lease.workItem.Payload["provider"] = "provider_copilot"
	lease.workItem.Payload["model"] = "copilot-cli"
	lease.workItem.Payload["runtimeDriver"] = "copilot-self-hosted"
	lease.workItem.Payload["runtimeRequirement"] = ama.JSON{"runtime": "copilot", "model": "copilot-cli"}
	lease.workItem.Payload["prompt"] = prompt
	return lease
}
