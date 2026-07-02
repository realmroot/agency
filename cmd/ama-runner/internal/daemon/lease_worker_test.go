package daemon

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

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
	t.Run("capability failure update", func(t *testing.T) {
		work := approvedLease()
		work.workItem.Payload["requiredRunnerCapability"] = "missing"
		client := &fakeAMAServer{lease: work, updateErr: updateErr}
		daemon := testDaemon(client, &fakeAdapter{})
		worker := daemon.leaseWorker()
		worker.CurrentCapabilities = func() []string { return nil }
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

func TestLeaseWorkerCapabilityHelpers(t *testing.T) {
	worker := LeaseWorker{}
	if !worker.supportsRequiredCapability("") {
		t.Fatal("empty capability should be supported")
	}
	if worker.supportsRequiredCapability("codex") {
		t.Fatal("nil capability provider should reject non-empty requirement")
	}
	worker.CurrentCapabilities = func() []string { return []string{"codex"} }
	if !worker.supportsRequiredCapability("runtime-provider-model:codex:*:gpt-5") {
		t.Fatal("runtime capability should satisfy provider-model requirement")
	}
	if worker.supportsRequiredCapability("runtime-provider-model") {
		t.Fatal("malformed provider-model capability should be rejected")
	}
	if got := requiredRuntimeCapability("runtime-provider-model:codex:*:gpt-5"); got != "codex" {
		t.Fatalf("expected codex runtime capability, got %q", got)
	}
	if got := requiredRuntimeCapability("bad"); got != "" {
		t.Fatalf("expected empty runtime capability, got %q", got)
	}
}

func TestLeaseWorkerRunAssignedHandlesFailureAndCancellationStates(t *testing.T) {
	work := approvedLease()
	work.workItem.Payload = ama.JSON{"protocol": "bad"}
	client := &fakeAMAServer{lease: work}
	relay := runnersession.NewRelay(client, "runner_1", "test", t.TempDir())
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
			Access:    "read_write",
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
