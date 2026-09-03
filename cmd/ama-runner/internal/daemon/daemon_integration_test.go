//go:build !windows

package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	ama "github.com/realmroot/enbor/sdk/go/enbor"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	runnerruntime "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	"github.com/samber/lo"
)

func TestDaemonRunOnceExecutesSandboxWorkThroughControlPlane(t *testing.T) {
	control := newRunnerIntegrationControlPlane(t)
	server := httptest.NewServer(control)
	t.Cleanup(server.Close)

	workDir := t.TempDir()
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_integration", APIServer: server.URL, AccessToken: "e2e-runner:integration",
		TokenType: "Bearer",
	}); err != nil {
		t.Fatal(err)
	}
	config := runnerconfig.Config{
		APIServer:             server.URL,
		CredentialPath:        credentialPath,
		ProjectID:             "project_integration",
		EnvironmentID:         "env_integration",
		AllowUnsafeProcess:    true,
		StateDir:              filepath.Join(t.TempDir(), "state"),
		WorkDir:               workDir,
		MaxConcurrent:         1,
		HeartbeatInterval:     time.Hour,
		LeaseDurationSeconds:  60,
		RenewInterval:         time.Hour,
		CommandTimeout:        5 * time.Second,
		ShutdownGraceInterval: 10 * time.Millisecond,
	}
	daemon, err := New(config, version.Info{Name: "ama-runner", Version: "test", Commit: "test", BuildDate: "test"})
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	daemon.RuntimeCatalog = &runnerruntime.Inventory{
		Load: func(context.Context, bool) (*runnerruntime.InventorySnapshot, error) {
			return &runnerruntime.InventorySnapshot{}, nil
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := daemon.RunOnce(ctx); err != nil {
		t.Fatalf("run once: %v", err)
	}
	cancel()

	control.waitForRunnerChannel(t)
	if got, err := os.ReadFile(filepath.Join(workDir, "runner-integration.txt")); err != nil || string(got) != "integration" {
		t.Fatalf("expected bash to write integration marker, got %q err=%v", got, err)
	}

	control.mu.Lock()
	defer control.mu.Unlock()
	if control.createdRunner == nil || control.createdRunner.EnvironmentId == nil || *control.createdRunner.EnvironmentId != "env_integration" {
		t.Fatalf("expected runner registration for env_integration, got %#v", control.createdRunner)
	}
	if control.heartbeat == nil || control.heartbeat.State == nil || *control.heartbeat.State != ama.PutRunnerHeartbeatRequestStateActive {
		t.Fatalf("expected active heartbeat, got %#v", control.heartbeat)
	}
	if len(control.leaseUpdates) == 0 {
		t.Fatal("expected completed lease update")
	}
	completed := control.leaseUpdates[len(control.leaseUpdates)-1]
	if completed.State == nil || *completed.State != ama.UpdateLeaseRequestStateCompleted {
		t.Fatalf("expected completed lease, got %#v", completed)
	}
	if completed.Result == nil {
		t.Fatal("expected completed lease result")
	}
	output, ok := (*completed.Result)["output"].(map[string]any)
	if !ok || output["stdout"] != "done" || output["exitCode"] != float64(0) {
		t.Fatalf("unexpected sandbox result %#v", completed.Result)
	}
	if len(control.events) != 2 {
		t.Fatalf("expected tool call and tool result events, got %#v", control.events)
	}
	if control.events[0]["type"] != "message.completed" || control.events[1]["type"] != "message.completed" {
		t.Fatalf("unexpected event types %#v", control.events)
	}
}

type runnerIntegrationControlPlane struct {
	t               *testing.T
	now             time.Time
	runnerID        string
	workItemID      string
	leaseID         string
	sessionID       string
	channelAccepted chan struct{}
	channelOnce     sync.Once

	mu             sync.Mutex
	createdRunner  *ama.CreateRunnerRequest
	heartbeat      *ama.PutRunnerHeartbeatRequest
	leaseUpdates   []ama.UpdateLeaseRequest
	events         []ama.JSON
	requestedPaths []string
}

func newRunnerIntegrationControlPlane(t *testing.T) *runnerIntegrationControlPlane {
	return &runnerIntegrationControlPlane{
		t:               t,
		now:             time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC),
		runnerID:        "runner_integration",
		workItemID:      "work_integration",
		leaseID:         "lease_integration",
		sessionID:       "session_integration",
		channelAccepted: make(chan struct{}),
	}
}

func (p *runnerIntegrationControlPlane) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	p.requestedPaths = append(p.requestedPaths, r.Method+" "+r.URL.RequestURI())
	p.mu.Unlock()

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/configz":
		writeRunnerIntegrationJSON(w, http.StatusOK, ama.PublicConfig{
			Version: ama.N1,
			Service: ama.PublicServiceConfig{
				Name:   ama.AnyManagedAgents,
				Origin: "https://ama.example.test",
			},
		})
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/runners":
		var body ama.CreateRunnerRequest
		decodeRunnerIntegrationJSON(p.t, r, &body)
		p.mu.Lock()
		p.createdRunner = &body
		p.mu.Unlock()
		writeRunnerIntegrationJSON(w, http.StatusCreated, p.runner(ama.RunnerStateOffline))
	case r.Method == http.MethodPut && r.URL.Path == "/api/v1/runners/"+p.runnerID+"/heartbeat":
		var body ama.PutRunnerHeartbeatRequest
		decodeRunnerIntegrationJSON(p.t, r, &body)
		p.mu.Lock()
		p.heartbeat = &body
		p.mu.Unlock()
		writeRunnerIntegrationJSON(w, http.StatusOK, ama.RunnerHeartbeat{
			RunnerId:     p.runnerID,
			State:        ama.RunnerHeartbeatState(lo.FromPtr(body.State)),
			CurrentLoad:  0,
			Runtimes:     lo.FromPtr(body.Runtimes),
			RuntimeUsage: lo.FromPtr(body.RuntimeUsage),
		})
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/runners/"+p.runnerID+"/channel":
		p.handleRunnerChannel(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/work-items":
		writeRunnerIntegrationJSON(w, http.StatusOK, ama.WorkItemListResponse{
			Data:       []ama.WorkItem{p.workItem()},
			Pagination: ama.ListPagination{HasMore: false, Limit: 50},
		})
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/leases":
		var body ama.CreateLeaseRequest
		decodeRunnerIntegrationJSON(p.t, r, &body)
		if body.WorkItemId != p.workItemID || body.RunnerId != p.runnerID {
			http.Error(w, "unexpected lease request", http.StatusBadRequest)
			return
		}
		writeRunnerIntegrationJSON(w, http.StatusCreated, p.lease(ama.LeaseStateActive))
	case r.Method == http.MethodGet && r.URL.Path == "/api/v1/work-items/"+p.workItemID:
		writeRunnerIntegrationJSON(w, http.StatusOK, p.workItem())
	case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/leases/"+p.leaseID:
		var body ama.UpdateLeaseRequest
		decodeRunnerIntegrationJSON(p.t, r, &body)
		p.mu.Lock()
		p.leaseUpdates = append(p.leaseUpdates, body)
		p.mu.Unlock()
		writeRunnerIntegrationJSON(w, http.StatusOK, p.lease(ama.LeaseState(lo.FromPtr(body.State))))
	case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions/"+p.sessionID+"/events":
		var body struct {
			Events []ama.JSON `json:"events"`
		}
		decodeRunnerIntegrationJSON(p.t, r, &body)
		p.mu.Lock()
		p.events = append(p.events, body.Events...)
		p.mu.Unlock()
		writeRunnerIntegrationJSON(w, http.StatusCreated, ama.SessionEventsAccepted{Accepted: len(body.Events)})
	default:
		http.Error(w, "unexpected runner integration path "+r.Method+" "+r.URL.Path, http.StatusNotFound)
	}
}

func (p *runnerIntegrationControlPlane) runner(state ama.RunnerState) ama.Runner {
	return ama.Runner{
		Id:            p.runnerID,
		Name:          "Integration runner",
		ProjectId:     "project_integration",
		EnvironmentId: lo.ToPtr("env_integration"),
		AuthMode:      ama.RunnerAuthModeRealmroot,
		State:         state,
		MaxConcurrent: 1,
		CurrentLoad:   0,
		Metadata:      map[string]any{},
		Runtimes:      []ama.RunnerRuntime{},
		RuntimeUsage:  []ama.RuntimeUsage{},
		CreatedAt:     p.now,
		UpdatedAt:     p.now,
	}
}

func (p *runnerIntegrationControlPlane) workItem() ama.WorkItem {
	return ama.WorkItem{
		Id:          p.workItemID,
		ProjectId:   "project_integration",
		Type:        "sandbox.tool",
		State:       ama.WorkItemStateAvailable,
		Priority:    0,
		Attempts:    0,
		MaxAttempts: 1,
		SessionId:   lo.ToPtr(p.sessionID),
		Payload: map[string]any{
			"protocol":   "ama-runner-work",
			"approved":   true,
			"sessionId":  p.sessionID,
			"toolCallId": "tool_integration",
			"toolName":   "bash",
			"input": map[string]any{
				"command": "printf integration > runner-integration.txt && printf done",
			},
		},
		CreatedAt:   p.now,
		UpdatedAt:   p.now,
		AvailableAt: p.now,
	}
}

func (p *runnerIntegrationControlPlane) lease(state ama.LeaseState) ama.Lease {
	return ama.Lease{
		Id:         p.leaseID,
		WorkItemId: p.workItemID,
		RunnerId:   p.runnerID,
		State:      state,
		CreatedAt:  p.now,
		UpdatedAt:  p.now,
		ExpiresAt:  p.now.Add(time.Minute),
	}
}

func (p *runnerIntegrationControlPlane) handleRunnerChannel(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		p.t.Errorf("accept runner channel: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "runner integration channel closed")
	if err := writeRunnerIntegrationWebSocket(r.Context(), conn, ama.JSON{
		"type":     "runner.channel.accepted",
		"runnerId": p.runnerID,
	}); err != nil {
		p.t.Errorf("write runner channel accepted: %v", err)
		return
	}
	p.channelOnce.Do(func() { close(p.channelAccepted) })
	<-r.Context().Done()
}

func (p *runnerIntegrationControlPlane) waitForRunnerChannel(t *testing.T) {
	t.Helper()
	select {
	case <-p.channelAccepted:
	case <-time.After(2 * time.Second):
		t.Fatalf("runner channel was not opened; requests: %s", strings.Join(p.requestedPaths, "\n"))
	}
}

func writeRunnerIntegrationJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeRunnerIntegrationJSON(t *testing.T, r *http.Request, out any) {
	t.Helper()
	if err := json.NewDecoder(r.Body).Decode(out); err != nil {
		t.Fatalf("decode %s %s: %v", r.Method, r.URL.Path, err)
	}
}

func writeRunnerIntegrationWebSocket(ctx context.Context, conn *websocket.Conn, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}
