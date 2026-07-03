package session

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func rawControl(value string) runtime.BridgeControlFrame {
	return runtime.BridgeControlFrame(value)
}

func TestHostHandleBuffersOpaqueCommandsBeforeSenderRegistered(t *testing.T) {
	router := NewHostHandle("session_1")
	router.deliverControl(rawControl(`{"type":"send","message":"first prompt"}`))
	router.deliverControl(rawControl(`{"type":"permissionDecision","permissionId":"perm_1","allowed":true}`))

	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, string(command))
		return nil
	})

	if len(received) != 2 {
		t.Fatalf("expected two buffered commands flushed, got %v", received)
	}
	if received[0] != `{"type":"send","message":"first prompt"}` || received[1] != `{"type":"permissionDecision","permissionId":"perm_1","allowed":true}` {
		t.Fatalf("expected opaque commands flushed unchanged, got %v", received)
	}
}

func TestHostHandleDeliversOpaqueCommandAfterSenderRegistered(t *testing.T) {
	router := NewHostHandle("session_1")

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})
	router.deliverControl(rawControl(`{"type":"abort","reason":"user cancelled"}`))

	if received != `{"type":"abort","reason":"user cancelled"}` {
		t.Fatalf("expected opaque command delivered unchanged, got %q", received)
	}
}

func TestHostHandleDeliverCommandDropsEmptyCommand(t *testing.T) {
	router := NewHostHandle("session_1")

	var received []string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = append(received, string(command))
		return nil
	})
	router.DeliverCommand(nil)

	if len(received) != 0 {
		t.Fatalf("expected empty command to be dropped, got %v", received)
	}
}

func TestHostHandleDeliverCommandForwardsOpaqueCommand(t *testing.T) {
	router := NewHostHandle("session_1")

	var received string
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		received = string(command)
		return nil
	})
	router.DeliverCommand(rawControl(`{"type":"send","message":"build it","extra":{"keep":true}}`))

	if received != `{"type":"send","message":"build it","extra":{"keep":true}}` {
		t.Fatalf("expected opaque command forwarded unchanged, got %q", received)
	}
}

func TestHostHandleLogsWhenLiveSendErrors(t *testing.T) {
	router := NewHostHandle("session_1")
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		return errors.New("send failed")
	})
	if err := router.deliverControl(rawControl(`{"type":"send","message":"failing prompt"}`)); err == nil {
		t.Fatal("expected live send error")
	}
}

func TestHostHandleRegisterControlSenderLogsFlushErrorAndContinues(t *testing.T) {
	router := NewHostHandle("session_1")
	router.deliverControl(rawControl(`{"type":"send","message":"first"}`))
	router.deliverControl(rawControl(`{"type":"abort","reason":"second"}`))

	var calls int
	router.RegisterControlSender(func(command runtime.BridgeControlFrame) error {
		calls += 1
		return errors.New("flush failed")
	})

	if calls != 2 {
		t.Fatalf("expected every buffered command to flush despite errors, got %d", calls)
	}
}

type fakeSandboxAdapter struct {
	request sandbox.ToolRequest
	result  sandbox.ToolResult
	err     error
}

func (f *fakeSandboxAdapter) Execute(_ context.Context, request sandbox.ToolRequest) (sandbox.ToolResult, error) {
	f.request = request
	return f.result, f.err
}

func testWorkspace(t *testing.T) *workspace.Workspace {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "session_1")
	root := filepath.Join(dir, "workspace")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	return &workspace.Workspace{Dir: dir, Root: root, Cwd: root}
}

func TestHostHandleCloseIsNoop(t *testing.T) {
	if err := NewHostHandle("session_1").Close(context.Background()); err != nil {
		t.Fatalf("close: %v", err)
	}
}

func TestSandboxHandleExecutesSandboxRequest(t *testing.T) {
	toolCallID := "call_1"
	toolName := "bash"
	input := map[string]any{"command": "pwd"}
	adapter := &fakeSandboxAdapter{
		result: sandbox.ToolResult{Output: map[string]any{"stdout": "/workspace\n", "exitCode": 0}},
	}
	handle := NewSandboxHandle("session_1", testWorkspace(t), adapter)

	result, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{
		Type:       "sandbox.execute",
		ToolCallId: &toolCallID,
		ToolName:   &toolName,
		Input:      &input,
	})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if result["toolCallId"] != toolCallID || result["toolName"] != toolName {
		t.Fatalf("unexpected response identity: %v", result)
	}
	output, _ := result["output"].(map[string]any)
	if output["stdout"] != "/workspace\n" {
		t.Fatalf("unexpected output: %v", output)
	}
	if adapter.request.ToolCallID != toolCallID || adapter.request.ToolName != toolName {
		t.Fatalf("adapter saw wrong request: %#v", adapter.request)
	}
	if adapter.request.WorkDir == "" {
		t.Fatal("adapter request did not include workspace cwd")
	}
}

func TestSandboxHandleExecuteReturnsToolErrorInResponse(t *testing.T) {
	toolCallID := "call_2"
	toolName := "bash"
	input := map[string]any{"command": "false"}
	handle := NewSandboxHandle("session_1", testWorkspace(t), &fakeSandboxAdapter{
		result: sandbox.ToolResult{Output: map[string]any{"stderr": "boom", "exitCode": 1}},
		err:    errors.New("command failed"),
	})

	result, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{
		Type:       "sandbox.execute",
		ToolCallId: &toolCallID,
		ToolName:   &toolName,
		Input:      &input,
	})
	if err != nil {
		t.Fatalf("tool errors are encoded in the response, got top-level error: %v", err)
	}
	if result["error"] == nil {
		t.Fatalf("expected encoded tool error, got %v", result)
	}
}

func TestSandboxHandleRejectsMissingAdapterOrWorkspace(t *testing.T) {
	handle := NewSandboxHandle("session_1", testWorkspace(t), nil)
	if _, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.execute"}); err == nil {
		t.Fatal("expected missing adapter error")
	}
	handle = NewSandboxHandle("session_1", nil, &fakeSandboxAdapter{})
	if _, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.execute"}); err == nil {
		t.Fatal("expected missing workspace error")
	}
}

func TestSandboxHandleStopClosesWorkspace(t *testing.T) {
	prepared := testWorkspace(t)
	handle := NewSandboxHandle("session_1", prepared, &fakeSandboxAdapter{})

	result, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.stop"})
	if err != nil {
		t.Fatalf("stop: %v", err)
	}
	if result["ok"] != true {
		t.Fatalf("expected ok response, got %v", result)
	}
	if _, err := os.Stat(prepared.Root); !os.IsNotExist(err) {
		t.Fatalf("expected workspace directory removed, stat err=%v", err)
	}
	if err := handle.Close(context.Background()); err != nil {
		t.Fatalf("second close should be idempotent: %v", err)
	}
	if _, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.execute"}); err == nil {
		t.Fatal("expected closed handle to reject sandbox execution")
	}
}

func TestSandboxHandleReadsWritableMemoryStores(t *testing.T) {
	handle := NewSandboxHandle("session_1", testWorkspace(t), &fakeSandboxAdapter{})
	result, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.readMemoryStores"})
	if err != nil {
		t.Fatalf("read memory stores: %v", err)
	}
	stores, ok := result["stores"].([]workspace.MemoryStoreSnapshot)
	if !ok {
		t.Fatalf("expected typed memory store slice, got %T", result["stores"])
	}
	if len(stores) != 0 {
		t.Fatalf("expected no memory stores, got %v", stores)
	}
}

func TestSandboxHandleRejectsUnsupportedRequest(t *testing.T) {
	handle := NewSandboxHandle("session_1", testWorkspace(t), &fakeSandboxAdapter{})
	if _, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.unknown"}); err == nil {
		t.Fatal("expected unsupported request error")
	}
}

func TestSandboxHandleReadMemoryStoresReturnsWorkspaceError(t *testing.T) {
	handle := NewSandboxHandle("session_1", nil, &fakeSandboxAdapter{})
	if _, err := handle.ExecuteSandbox(context.Background(), protocol.RunnerSandboxRequest{Type: "sandbox.readMemoryStores"}); err == nil {
		t.Fatal("expected missing workspace error")
	}
}

var _ SandboxHandler = (*SandboxHandle)(nil)
var _ sandbox.SandboxAdapter = (*fakeSandboxAdapter)(nil)
var _ = ama.JSON{}
