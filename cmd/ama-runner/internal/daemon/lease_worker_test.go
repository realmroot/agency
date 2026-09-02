package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

type signalingReadCloser struct {
	*strings.Reader
	close func() error
}

func (r signalingReadCloser) Close() error {
	return r.close()
}

func TestResumeTokenBox(t *testing.T) {
	var nilBox *resumeTokenBox
	nilBox.Set("ignored")
	if got := nilBox.Get(); got != "" {
		t.Fatalf("expected nil token box to return empty token, got %q", got)
	}
	box := &resumeTokenBox{}
	box.Set("")
	if got := box.Get(); got != "" {
		t.Fatalf("expected empty token to be ignored, got %q", got)
	}
	box.Set("resume_1")
	if got := box.Get(); got != "resume_1" {
		t.Fatalf("expected stored resume token, got %q", got)
	}
	if box.SetIfChanged("resume_1") {
		t.Fatal("expected duplicate resume token to be ignored")
	}
	if !box.SetIfChanged("resume_2") {
		t.Fatal("expected changed resume token to be stored")
	}
	if got := box.Get(); got != "resume_2" {
		t.Fatalf("expected changed resume token, got %q", got)
	}
}

func TestLeaseWorkerPersistResumeToken(t *testing.T) {
	t.Run("updates active lease once per token", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease()}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		tokens := &resumeTokenBox{}
		leaseUpdates := &sync.Mutex{}

		if err := worker.persistResumeToken(context.Background(), client.lease.lease, tokens, leaseUpdates, "resume_1"); err != nil {
			t.Fatalf("expected resume token update, got %v", err)
		}
		if err := worker.persistResumeToken(context.Background(), client.lease.lease, tokens, leaseUpdates, "resume_1"); err != nil {
			t.Fatalf("expected duplicate resume token to be ignored, got %v", err)
		}
		if len(client.updates) != 1 || leaseState(client.updates[0]) != "active" {
			t.Fatalf("expected one active lease update, got %#v", client.updates)
		}
		if client.updates[0].ResumeToken == nil || *client.updates[0].ResumeToken != "resume_1" {
			t.Fatalf("expected resume token in lease update, got %#v", client.updates[0])
		}
		if got := tokens.Get(); got != "resume_1" {
			t.Fatalf("expected stored resume token, got %q", got)
		}
	})

	t.Run("propagates update errors", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease(), updateErr: errors.New("lease update failed")}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		err := worker.persistResumeToken(
			context.Background(),
			client.lease.lease,
			&resumeTokenBox{},
			&sync.Mutex{},
			"resume_1",
		)
		if err == nil || !strings.Contains(err.Error(), "runner lease resume token update failed") {
			t.Fatalf("expected resume token update error, got %v", err)
		}
	})
}

func TestIsSupportedSessionRuntimeAcceptsNonEmptyRuntime(t *testing.T) {
	for _, runtime := range []string{"ama", "claude-code", "codex", "copilot", "future-runtime"} {
		if !isSupportedSessionRuntime(runtime) {
			t.Fatalf("expected %q to be a supported session runtime", runtime)
		}
	}
}

func TestIsSupportedSessionRuntimeRejectsEmptyRuntime(t *testing.T) {
	if isSupportedSessionRuntime("") {
		t.Fatal("expected empty runtime to be rejected")
	}
}

func TestLeaseWorkerSessionStartDoesNotBranchOnExternalRuntimeNames(t *testing.T) {
	packages, err := parser.ParseDir(token.NewFileSet(), ".", func(info fs.FileInfo) bool {
		return !strings.HasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	var runSessionStart *ast.FuncDecl
	for _, pkg := range packages {
		for _, source := range pkg.Files {
			for _, decl := range source.Decls {
				function, ok := decl.(*ast.FuncDecl)
				if ok && function.Name.Name == "runSessionStart" {
					runSessionStart = function
					break
				}
			}
		}
	}
	if runSessionStart == nil {
		t.Fatal("runSessionStart function not found")
	}

	runtimeNames := map[string]bool{
		"codex":       true,
		"claude-code": true,
		"copilot":     true,
	}
	ast.Inspect(runSessionStart.Body, func(node ast.Node) bool {
		literal, ok := node.(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatalf("expected string literal to unquote: %v", err)
		}
		if runtimeNames[value] {
			t.Fatalf("runSessionStart contains runtime-specific literal %q", value)
		}
		return true
	})
}

func TestLeaseWorkerFailsSessionStartWhenRelayIsNil(t *testing.T) {
	lease := sessionStartLease()
	client := &fakeAMAServer{lease: lease}
	daemon := testDaemon(client, &fakeAdapter{})
	payload, err := protocol.ParseWorkPayload(lease.workItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := daemon.leaseWorker().runSessionStart(context.Background(), lease.lease, payload); err == nil {
		t.Fatal("expected session start error when relay is nil")
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestLeaseWorkerRejectsUnsupportedSessionRuntime(t *testing.T) {
	client := &fakeAMAServer{lease: sessionStartLease()}
	daemon := testDaemon(client, &fakeAdapter{})
	err := daemon.leaseWorker().runSessionStart(context.Background(), client.lease.lease, protocol.WorkPayload{
		Runtime:   "",
		SessionID: "session_1",
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported session runtime") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestLeaseWorkerRunToolFailsWithoutSandboxAdapter(t *testing.T) {
	work := approvedLease()
	client := &fakeAMAServer{lease: work}
	daemon := testDaemon(client, nil)
	payload, err := protocol.ParseWorkPayload(work.workItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	err = daemon.leaseWorker().runTool(context.Background(), work.lease, work.workItem, payload)
	if err == nil || !strings.Contains(err.Error(), "sandbox adapter") {
		t.Fatalf("expected missing sandbox adapter error, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "failed" {
		t.Fatalf("expected failed lease update, got %#v", client.updates)
	}
}

func TestLeaseWorkerRunToolPassesPayloadEnvironment(t *testing.T) {
	work := approvedLease()
	work.workItem.Payload["env"] = map[string]any{
		"GH_TOKEN":     "github-value",
		"CUSTOM_TOKEN": "custom-value",
	}
	client := &fakeAMAServer{lease: work}
	adapter := &fakeAdapter{
		result: sandbox.ToolResult{Output: map[string]any{"stdout": "ok", "exitCode": 0}},
	}
	daemon := testDaemon(client, adapter)
	payload, err := protocol.ParseWorkPayload(work.workItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := daemon.leaseWorker().runTool(context.Background(), work.lease, work.workItem, payload); err != nil {
		t.Fatalf("expected tool success, got %v", err)
	}
	request := adapter.lastRequest()
	if request.Env["GH_TOKEN"] != "github-value" || request.Env["CUSTOM_TOKEN"] != "custom-value" {
		t.Fatalf("expected payload env in sandbox request, got %#v", request.Env)
	}
}

func TestLeaseWorkerPropagatesLeaseUpdateFailures(t *testing.T) {
	updateErr := errors.New("lease update failed")
	t.Run("invalid payload failure update", func(t *testing.T) {
		work := approvedLease()
		work.workItem.Payload = ama.JSON{"protocol": "bad"}
		client := &fakeAMAServer{lease: work, updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		err := daemon.leaseWorker().runClaimedWork(context.Background(), work.lease, work.workItem)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
	t.Run("runtime requirement failure update", func(t *testing.T) {
		work := sessionStartLease()
		work.workItem.Payload["runtimeRequirement"] = ama.JSON{"runtime": "missing"}
		client := &fakeAMAServer{lease: work, updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		worker.CurrentRuntimes = nil
		err := worker.runClaimedWork(context.Background(), work.lease, work.workItem)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
	t.Run("missing ama relay failure update", func(t *testing.T) {
		work := sessionStartLease()
		client := &fakeAMAServer{lease: work, updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		payload, err := protocol.ParseWorkPayload(work.workItem.Payload)
		if err != nil {
			t.Fatal(err)
		}
		err = daemon.leaseWorker().runAMASandboxSession(context.Background(), work.lease, payload)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
	t.Run("runtime timeout failure update", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease(), updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		err := worker.finalizeRuntimeSession(
			context.Background(),
			context.Background(),
			client.lease.lease,
			nil,
			runtime.Result{Err: errors.New("timeout"), TimedOut: true},
			func(ama.JSON) {},
		)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
	t.Run("runtime generic failure update", func(t *testing.T) {
		client := &fakeAMAServer{lease: approvedLease(), updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		err := worker.finalizeRuntimeSession(
			context.Background(),
			context.Background(),
			client.lease.lease,
			nil,
			runtime.Result{Err: errors.New("runtime failed")},
			func(ama.JSON) {},
		)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
	t.Run("ama workspace failure update", func(t *testing.T) {
		work := sessionStartLease()
		client := &fakeAMAServer{lease: work, updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		relayCtx, cancelRelay := context.WithCancel(context.Background())
		defer cancelRelay()
		daemon.startRelay(relayCtx)
		payload, err := protocol.ParseWorkPayload(work.workItem.Payload)
		if err != nil {
			t.Fatal(err)
		}
		payload.SessionID = "../bad"
		err = daemon.leaseWorker().runAMASandboxSession(context.Background(), work.lease, payload)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
	t.Run("ama runtime started upload failure update", func(t *testing.T) {
		work := sessionStartLease()
		client := &fakeAMAServer{lease: work, eventErr: errors.New("event upload failed"), updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		relayCtx, cancelRelay := context.WithCancel(context.Background())
		defer cancelRelay()
		daemon.startRelay(relayCtx)
		payload, err := protocol.ParseWorkPayload(work.workItem.Payload)
		if err != nil {
			t.Fatal(err)
		}
		err = daemon.leaseWorker().runAMASandboxSession(context.Background(), work.lease, payload)
		if err == nil || !strings.Contains(err.Error(), updateErr.Error()) {
			t.Fatalf("expected update error, got %v", err)
		}
	})
}

// [spec: runners/eligibility]
func TestLeaseWorkerRuntimeRequirementHelpers(t *testing.T) {
	worker := LeaseWorker{}
	if worker.supportsRuntimeRequirement(&protocol.RuntimeRequirement{Runtime: "codex"}) {
		t.Fatal("missing runner inventory providers should reject the requirement")
	}
	worker.CurrentRuntimes = func() []runtime.RunnerRuntime {
		return []runtime.RunnerRuntime{{Runtime: "codex", Models: []string{"gpt-5"}, State: runtime.RuntimeStateReady}}
	}
	if !worker.supportsRuntimeRequirement(&protocol.RuntimeRequirement{Runtime: "codex", Model: "gpt-5"}) {
		t.Fatal("matching ready runtime should satisfy the requirement")
	}
	if worker.supportsRuntimeRequirement(&protocol.RuntimeRequirement{Runtime: "codex", Model: "other"}) {
		t.Fatal("non-matching model should be rejected")
	}
	if !worker.supportsRuntimeRequirement(&protocol.RuntimeRequirement{Runtime: "codex"}) {
		t.Fatal("empty model should accept a ready runtime")
	}
	worker.CurrentRuntimes = func() []runtime.RunnerRuntime {
		return []runtime.RunnerRuntime{{Runtime: "codex", Models: []string{"gpt-5"}, State: runtime.RuntimeStateLimited}}
	}
	if !worker.supportsRuntimeRequirement(&protocol.RuntimeRequirement{Runtime: "codex", Model: "gpt-5"}) {
		t.Fatal("an assigned lease should remain compatible when its matching runtime becomes limited")
	}
	if worker.supportsRuntimeRequirement(&protocol.RuntimeRequirement{Runtime: "codex", Model: "other"}) {
		t.Fatal("a limited runtime must still reject a non-matching assigned model")
	}
}

func TestLeaseWorkerRunAssignedHandlesFailureAndCancellationStates(t *testing.T) {
	work := approvedLease()
	work.workItem.Payload = ama.JSON{"protocol": "bad"}
	client := &fakeAMAServer{lease: work}
	relay := runnersession.NewRelay(client, "runner_1", t.TempDir())
	daemon := testDaemon(client, &fakeAdapter{})
	worker := daemon.leaseWorker()
	worker.Relay = relay

	if err := worker.RunAssigned(context.Background(), work.lease, work.workItem); err == nil {
		t.Fatal("expected invalid assigned work error")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := worker.RunAssigned(ctx, work.lease, work.workItem); err == nil {
		t.Fatal("expected cancelled invalid assigned work error")
	}
}

// [spec: runners/ama-sandbox-channel]
func TestLeaseWorkerRunAssignedMarksOnlySuccessfulAMAStartupSessionActive(t *testing.T) {
	tests := []struct {
		name       string
		work       func() *fakeWork
		configure  func(*Daemon, *fakeAMAServer)
		wantErr    bool
		wantActive bool
	}{
		{
			name:       "successful parsed AMA session start",
			work:       sessionStartLease,
			wantActive: true,
		},
		{
			name: "successful external runtime session start",
			work: func() *fakeWork { return codexSessionStartLease("complete the task") },
			configure: func(daemon *Daemon, _ *fakeAMAServer) {
				daemon.RuntimeAdapter = &fakeRuntimeAdapter{result: ama.JSON{"exitCode": 0}}
			},
		},
		{
			name: "successful non-session work",
			work: approvedLease,
		},
		{
			name: "malformed work payload",
			work: func() *fakeWork {
				work := approvedLease()
				work.workItem.Payload = ama.JSON{"protocol": "bad"}
				return work
			},
			wantErr: true,
		},
		{
			name: "failed AMA session start",
			work: sessionStartLease,
			configure: func(_ *Daemon, client *fakeAMAServer) {
				client.eventErr = errors.New("runtime start event failed")
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			work := test.work()
			channel := newFakeSessionChannel(ama.JSON{"type": "runner.channel.accepted"})
			client := &fakeAMAServer{lease: work, hubChannel: channel}
			daemon := testDaemon(client, &fakeAdapter{result: sandbox.ToolResult{Output: map[string]any{"exitCode": 0}}})
			if test.configure != nil {
				test.configure(&daemon, client)
			}
			relayCtx, cancelRelay := context.WithCancel(context.Background())
			defer cancelRelay()
			daemon.startRelay(relayCtx)
			waitForChannelWriteCount(t, channel, 1)

			err := daemon.leaseWorker().RunAssigned(context.Background(), work.lease, work.workItem)
			if (err != nil) != test.wantErr {
				t.Fatalf("RunAssigned error = %v, wantErr %v", err, test.wantErr)
			}

			var completion ama.JSON
			for _, message := range channel.writtenMessages() {
				if typ, _ := message["type"].(string); strings.HasPrefix(typ, "work.") {
					completion = message
				}
			}
			if completion == nil {
				t.Fatalf("expected work completion frame, got %v", channel.writtenMessages())
			}
			if completion["sessionActive"] != test.wantActive {
				t.Fatalf("sessionActive = %v, want %v in %v", completion["sessionActive"], test.wantActive, completion)
			}
		})
	}
}

// [spec: runners/ama-sandbox-channel]
func TestAMASandboxRenewalFailureAfterCompletionUnregistersAndCleansHandle(t *testing.T) {
	work := sessionStartLease()
	activeUpdateStarted := make(chan struct{})
	releaseActiveUpdate := make(chan struct{})
	activeUpdateReturned := make(chan struct{})
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		response := func(status int) *http.Response {
			header := make(http.Header)
			header.Set("content-type", "application/json")
			return &http.Response{
				StatusCode: status,
				Header:     header,
				Body:       http.NoBody,
				Request:    request,
			}
		}
		if strings.HasSuffix(request.URL.Path, "/events") {
			<-activeUpdateStarted
			result := response(http.StatusCreated)
			result.Body = io.NopCloser(strings.NewReader(`{"accepted":1}`))
			return result, nil
		}
		if request.Method != http.MethodPatch || !strings.HasPrefix(request.URL.Path, "/api/v1/leases/") {
			return nil, fmt.Errorf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		var update ama.UpdateLeaseRequest
		if err := json.NewDecoder(request.Body).Decode(&update); err != nil {
			return nil, err
		}
		if leaseState(update) == "active" {
			close(activeUpdateStarted)
			<-releaseActiveUpdate
			close(activeUpdateReturned)
			return nil, errors.New("renew transport failed")
		}
		body, err := json.Marshal(work.lease)
		if err != nil {
			return nil, err
		}
		result := response(http.StatusOK)
		result.Body = signalingReadCloser{
			Reader: strings.NewReader(string(body)),
			close: func() error {
				close(releaseActiveUpdate)
				<-activeUpdateReturned
				time.Sleep(10 * time.Millisecond)
				return nil
			},
		}
		return result, nil
	})
	client, err := ama.NewRunner(ama.ClientConfig{
		BaseURL:    "https://runner.test",
		HTTPClient: &http.Client{Transport: transport},
	})
	if err != nil {
		t.Fatalf("create runner client: %v", err)
	}
	workDir := t.TempDir()
	daemon := testDaemon(&fakeAMAServer{}, &fakeAdapter{})
	daemon.Config.WorkDir = workDir
	daemon.Config.RenewInterval = time.Millisecond
	worker := daemon.leaseWorker()
	worker.Client = client
	worker.Relay = runnersession.NewRelay(&fakeAMAServer{}, "runner_1", workDir)

	err = worker.RunAssigned(context.Background(), work.lease, work.workItem)
	if err == nil || !strings.Contains(err.Error(), "runner lease renewal failed") {
		t.Fatalf("expected non-race renewal failure, got %v", err)
	}
	workspacePath := filepath.Join(workDir, workspace.SessionsDirName, "session_1", "workspace")
	if _, statErr := os.Stat(workspacePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected failed AMA handle workspace to be cleaned, got %v", statErr)
	}
}

func TestIsCompletedLeaseRenewalRaceMatchesMessage(t *testing.T) {
	if !isCompletedLeaseRenewalRace(fmt.Errorf("runner lease renewal failed: Runner lease is no longer active")) {
		t.Fatal("expected race detection for 'Runner lease is no longer active'")
	}
	if !isCompletedLeaseRenewalRace(fmt.Errorf("runner renewal: Runner lease is no longer active in state completed")) {
		t.Fatal("expected race detection for message containing 'Runner lease is no longer active'")
	}
}

func TestIsCompletedLeaseRenewalRaceRejectsOtherErrors(t *testing.T) {
	if isCompletedLeaseRenewalRace(nil) {
		t.Fatal("nil must not be a race error")
	}
	if isCompletedLeaseRenewalRace(fmt.Errorf("runner lease renewal failed: connection refused")) {
		t.Fatal("unrelated renewal error must not be treated as a race")
	}
	if isCompletedLeaseRenewalRace(fmt.Errorf("ama.Lease is no longer active")) {
		t.Fatal("lowercase 'lease' form must not match")
	}
}

func TestIsLeaseInactive(t *testing.T) {
	if !isLeaseInactive(errors.New("lease_1 is no longer active")) {
		t.Fatal("expected inactive lease message to match")
	}
	if isLeaseInactive(nil) || isLeaseInactive(errors.New("network failed")) {
		t.Fatal("expected unrelated errors not to match")
	}
}

func TestCloneResult(t *testing.T) {
	source := map[string]any{"exitCode": 0}
	cloned := cloneResult(source)
	cloned["exitCode"] = 1
	if source["exitCode"] != 0 {
		t.Fatalf("expected clone mutation not to affect source, got %#v", source)
	}
}

func TestSuccessfulRuntimeResult(t *testing.T) {
	for _, result := range []map[string]any{
		{"exitCode": 0},
		{"output": map[string]any{"exitCode": int64(0)}},
		{"output": map[string]any{"exitCode": float64(0)}},
		{"output": ama.JSON{"exitCode": 0}},
	} {
		if !successfulRuntimeResult(result) {
			t.Fatalf("expected successful result for %#v", result)
		}
	}
	for _, result := range []map[string]any{
		nil,
		{"exitCode": 1},
		{"output": map[string]any{"exitCode": 1}},
		{"output": map[string]any{"exitCode": "0"}},
	} {
		if successfulRuntimeResult(result) {
			t.Fatalf("expected unsuccessful result for %#v", result)
		}
	}
}

func TestLeaseWorkerLeafHelpers(t *testing.T) {
	client := &fakeAMAServer{lease: approvedLease()}
	daemon := testDaemon(client, &fakeAdapter{})
	worker := daemon.leaseWorker()
	if err := worker.uploadSessionEvent(context.Background(), "", ama.JSON{"type": "ignored"}); err != nil {
		t.Fatalf("empty session event upload should be ignored: %v", err)
	}
	if got := workPrompt(protocol.WorkPayload{}); got != "" {
		t.Fatalf("expected empty prompt, got %q", got)
	}
	if got := promptWithSkillRefresh("build it", workspace.AgentPrepareReport{}); got != "build it" {
		t.Fatalf("expected unchanged prompt without skill changes, got %q", got)
	}
	if got := promptWithSkillRefresh("", workspace.AgentPrepareReport{SkillChanges: []workspace.SkillRefreshChange{{Ref: "ama@review", Status: "updated"}}}); got != "" {
		t.Fatalf("expected empty prompt to stay empty, got %q", got)
	}
	refreshed := promptWithSkillRefresh("build it", workspace.AgentPrepareReport{
		SkillChanges: []workspace.SkillRefreshChange{{Ref: "ama@review", Status: "updated"}},
	})
	for _, want := range []string{
		"Workspace skills were refreshed before this prompt.",
		"- ama@review: updated",
		"User prompt:\nbuild it",
	} {
		if !strings.Contains(refreshed, want) {
			t.Fatalf("expected refreshed prompt to contain %q, got %q", want, refreshed)
		}
	}
	if got := toolResultContent(nil); len(got) != 1 || got[0]["type"] != "json" {
		t.Fatalf("expected nil output to render as json block, got %#v", got)
	}
	if got := toolResultText(ama.JSON{"bad": func() {}}); got != "" {
		t.Fatalf("expected unmarshalable output to produce no text, got %q", got)
	}
}

func TestRunToolCancelsLeaseWhenContextIsCancelledBeforeEventUpload(t *testing.T) {
	work := approvedLease()
	client := &fakeAMAServer{lease: work}
	daemon := testDaemon(client, &fakeAdapter{})
	worker := daemon.leaseWorker()
	payload, err := protocol.ParseWorkPayload(work.workItem.Payload)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := worker.runTool(ctx, work.lease, work.workItem, payload); err != nil {
		t.Fatalf("expected cancelled lease update to succeed, got %v", err)
	}
	if len(client.updates) != 1 || leaseState(client.updates[0]) != "cancelled" {
		t.Fatalf("expected cancelled lease update, got %#v", client.updates)
	}
}

func TestAttachMemoryStoresBranches(t *testing.T) {
	worker := LeaseWorker{}
	failed := runtime.Result{Err: errors.New("runtime failed")}
	if got := worker.attachMemoryStores(&workspace.Workspace{}, failed); got.Err == nil || got.Err.Error() != "runtime failed" {
		t.Fatalf("expected failed runtime result unchanged, got %#v", got)
	}
	prepared, err := workspace.Prepare(context.Background(), workspace.PrepareRequest{
		WorkDir:   t.TempDir(),
		SessionID: "session_1",
		Manifest: protocol.WorkspaceManifest{Mounts: []protocol.WorkspaceMount{{
			Type:      "memory",
			MemoryRef: "ama://memories/store_1",
			ReadOnly:  false,
			Files:     []protocol.WorkspaceFile{{Path: "memory.md", Content: "remember"}},
		}}},
	})
	if err != nil {
		t.Fatalf("prepare memory workspace: %v", err)
	}
	t.Cleanup(func() { _ = prepared.Cleanup(context.Background()) })
	got := worker.attachMemoryStores(prepared, runtime.Result{})
	if got.Err != nil {
		t.Fatalf("expected memory attach success, got %#v", got)
	}
	if got.Output == nil || got.Output["memoryStores"] == nil {
		t.Fatalf("expected memory stores in result, got %#v", got.Output)
	}
	if err := os.RemoveAll(filepath.Join(prepared.Root, ".ama", "memory-stores", "store_1")); err != nil {
		t.Fatal(err)
	}
	got = worker.attachMemoryStores(prepared, runtime.Result{Output: ama.JSON{"exitCode": 0}})
	if got.Err == nil {
		t.Fatal("expected memory read error")
	}
}

func TestPrepareWorkspaceErrors(t *testing.T) {
	worker := LeaseWorker{Config: runnerconfig.Config{WorkDir: t.TempDir()}}
	if _, _, err := worker.prepareWorkspace(context.Background(), protocol.WorkPayload{SessionID: "../bad"}); err == nil {
		t.Fatal("expected invalid session workspace error")
	}
	if _, _, err := worker.prepareWorkspace(context.Background(), protocol.WorkPayload{
		SessionID:     "session_1",
		Runtime:       "codex",
		AgentSnapshot: map[string]any{"skills": []any{"not-a-valid-skill-ref"}},
	}); err == nil {
		t.Fatal("expected invalid agent skill error")
	}
}

func TestRelayStoredEventReturnsAppendError(t *testing.T) {
	parentFile := filepath.Join(t.TempDir(), "events-parent")
	if err := os.WriteFile(parentFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := runnersession.OpenEventLog(filepath.Join(parentFile, "session"), "session_1")
	if err == nil {
		t.Fatalf("expected event log open error, got store %#v", store)
	}
}
