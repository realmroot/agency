package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRuntimeBridgeHostEnvIncludesNodeToolchainAndTestModeOnly(t *testing.T) {
	t.Setenv("VOLTA_HOME", "/volta")
	t.Setenv("NODE_PATH", "/node-path")
	t.Setenv("PNPM_HOME", "/pnpm")
	t.Setenv("NVM_DIR", "/nvm")
	t.Setenv("AMA_RUNTIME_BRIDGE_TEST_MODE", "1")
	t.Setenv("AMA_TOKEN", "raw-secret-value")
	env := appendRuntimeBridgeHostEnv([]string{"PATH=/bin"})
	envText := strings.Join(env, "\n")
	for _, expected := range []string{
		"AMA_RUNTIME_BRIDGE_HOST_HOME=",
		"VOLTA_HOME=/volta",
		"NODE_PATH=/node-path",
		"PNPM_HOME=/pnpm",
		"NVM_DIR=/nvm",
		"AMA_RUNTIME_BRIDGE_TEST_MODE=1",
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected bridge host env %q in %q", expected, envText)
		}
	}
	if strings.Contains(envText, "raw-secret-value") {
		t.Fatalf("expected runner secrets to remain filtered, got %q", envText)
	}
}

func TestRuntimeBridgeReturnsProviderRegistryErrorForUnsupportedRuntime(t *testing.T) {
	_, err := (Bridge{}).Run(context.Background(), Request{Runtime: "unknown"}, func(JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "Unsupported runtime provider") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
}

func TestRuntimeBridgeRejectsMissingRuntimeAndNode(t *testing.T) {
	if _, err := (Bridge{}).Run(context.Background(), Request{}, func(JSON) error { return nil }); err == nil || !strings.Contains(err.Error(), "runtime is required") {
		t.Fatalf("expected missing runtime error, got %v", err)
	}
	t.Setenv("PATH", t.TempDir())
	if _, err := (Bridge{}).Run(context.Background(), Request{Runtime: "codex"}, func(JSON) error { return nil }); err == nil || !strings.Contains(err.Error(), "requires Node.js") {
		t.Fatalf("expected missing node error, got %v", err)
	}
	if _, err := (Bridge{}).Inventory(context.Background(), false); err == nil || !strings.Contains(err.Error(), "node is required") {
		t.Fatalf("expected inventory missing node error, got %v", err)
	}
}

func TestResolveNodeExecutableUsesRuntimeManagerTarget(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell shim fixture is Unix-only")
	}
	dir := t.TempDir()
	actualNode := filepath.Join(dir, "actual-node")
	if err := os.WriteFile(actualNode, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	shimNode := filepath.Join(dir, "node")
	shim := "#!/bin/sh\nif [ \"$1\" = \"-p\" ]; then\n  printf '%s\\n' '" + actualNode + "'\n  exit 0\nfi\nexit 1\n"
	if err := os.WriteFile(shimNode, []byte(shim), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)

	resolved, err := resolveNodeExecutable(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if resolved != actualNode {
		t.Fatalf("expected runtime manager target %q, got %q", actualNode, resolved)
	}
}

func installFakeNode(t *testing.T, script string) string {
	t.Helper()
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "node.sh")
	fakeNode := filepath.Join(dir, "node")
	if runtime.GOOS == "windows" {
		fakeNode += ".cmd"
	}
	probe := "if [ \"$1\" = \"-p\" ]; then\n  printf '%s\\n' '" + fakeNode + "'\n  exit 0\nfi\n"
	script = strings.Replace(script, "#!/bin/sh\n", "#!/bin/sh\n"+probe, 1)
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" {
		if err := os.WriteFile(fakeNode, []byte("@echo off\r\nsh \"%~dp0node.sh\" %*\r\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	} else if err := os.Rename(scriptPath, fakeNode); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return fakeNode
}

func TestRuntimeBridgeRunReadsEventsResumeTokenAndResult(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{"type":"resumeToken","requestId":"run_session_1","resumeToken":"resume-token"}'
echo '{"type":"provider.event","requestId":"run_session_1","runtime":"codex","event":{"type":"item.completed","item":{"id":"item_1"}}}'
echo '{"type":"runtime.event","requestId":"other","event":{"type":"message.completed","ignored":true}}'
echo '{"type":"runtime.event","requestId":"run_session_1","event":{"type":"message.completed","message":{"role":"assistant"}}}'
echo '{"type":"result","requestId":"run_session_1","result":{"ok":true}}'
echo 'bridge warning' >&2
`)
	var events []JSON
	var providerEvents []JSON
	var providerRuntime string
	var resumeToken string
	result, err := (Bridge{}).Run(context.Background(), Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"model": "gpt-5"},
		Provider:      "openai",
		Model:         "gpt-5",
		AgentSnapshot: map[string]any{"name": "agent"},
		Prompt:        "hello",
		Resume:        true,
		ResumeToken:   "old-token",
		WorkDir:       t.TempDir(),
		OnResumeToken: func(value string) error {
			resumeToken = value
			return nil
		},
		OnProviderEvent: func(runtimeName string, event JSON) error {
			providerRuntime = runtimeName
			providerEvents = append(providerEvents, event)
			return nil
		},
	}, func(event JSON) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("expected bridge run success, got %v result=%#v", err, result)
	}
	if result["ok"] != true || result["exitCode"] != 0 {
		t.Fatalf("unexpected bridge result: %#v", result)
	}
	if resumeToken != "resume-token" {
		t.Fatalf("expected resume token callback, got %q", resumeToken)
	}
	if len(events) != 1 || events[0]["type"] != "message.completed" {
		t.Fatalf("expected one matching runtime event, got %#v", events)
	}
	if providerRuntime != "codex" || len(providerEvents) != 1 || providerEvents[0]["type"] != "item.completed" {
		t.Fatalf("expected one matching provider event, runtime=%q events=%#v", providerRuntime, providerEvents)
	}
}

func TestRuntimeBridgeRunStopsBridgeProcessAfterProtocolReadError(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{'
sleep 5
`)
	startedAt := time.Now()
	result, err := (Bridge{}).Run(context.Background(), Request{
		Runtime:   "codex",
		SessionID: "session_1",
		WorkDir:   t.TempDir(),
	}, func(JSON) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "invalid runtime bridge message") {
		t.Fatalf("expected invalid protocol message error, result=%#v err=%v", result, err)
	}
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Fatalf("expected protocol read error to stop the bridge promptly, took %s", elapsed)
	}
}

func TestRuntimeBridgeRunRelaysLargeNativeRuntimeEvent(t *testing.T) {
	// [spec: runtime/large-bridge-events]
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
printf '{"type":"runtime.event","requestId":"run_session_1","event":{"type":"message.completed","payload":{"text":"'
dd if=/dev/zero bs=1100000 count=1 2>/dev/null | tr '\000' x
printf '"}}}\n'
echo '{"type":"result","requestId":"run_session_1","result":{"ok":true}}'
`)
	var events []JSON
	result, err := (Bridge{}).Run(context.Background(), Request{
		Runtime:   "codex",
		SessionID: "session_1",
		WorkDir:   t.TempDir(),
	}, func(event JSON) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("expected large native event success, result=%#v err=%v", result, err)
	}
	if result["ok"] != true || len(events) != 1 {
		t.Fatalf("unexpected bridge result=%#v events=%#v", result, events)
	}
	payload, ok := events[0]["payload"].(map[string]any)
	if !ok || len(payload["text"].(string)) != 1100000 {
		t.Fatalf("expected full large payload, got %#v", events[0]["payload"])
	}
}

func TestRuntimeBridgeRunReportsReadyAndProcessFailures(t *testing.T) {
	t.Run("ready failure includes stderr", func(t *testing.T) {
		installFakeNode(t, `#!/bin/sh
echo 'startup failed' >&2
exit 2
`)
		_, err := (Bridge{}).Run(context.Background(), Request{Runtime: "codex", WorkDir: t.TempDir()}, func(JSON) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "exited before ready") || !strings.Contains(err.Error(), "startup failed") {
			t.Fatalf("expected ready failure with stderr, got %v", err)
		}
	})
	t.Run("bridge exits nonzero after result", func(t *testing.T) {
		installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{"type":"result","requestId":"run_session_1","result":{"ok":true}}'
exit 7
`)
		result, err := (Bridge{}).Run(context.Background(), Request{Runtime: "codex", SessionID: "session_1", WorkDir: t.TempDir()}, func(JSON) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "exited with code 7") {
			t.Fatalf("expected bridge exit error, result=%#v err=%v", result, err)
		}
		if result["exitCode"] != 7 {
			t.Fatalf("expected exitCode 7, got %#v", result)
		}
	})
	t.Run("bridge reported runtime error", func(t *testing.T) {
		installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{"type":"error","requestId":"run_session_1","error":{"message":"runtime failed"}}'
`)
		result, err := (Bridge{}).Run(context.Background(), Request{Runtime: "codex", SessionID: "session_1", WorkDir: t.TempDir()}, func(JSON) error { return nil })
		if err == nil || !strings.Contains(err.Error(), "runtime failed") {
			t.Fatalf("expected runtime error, result=%#v err=%v", result, err)
		}
		if result["exitCode"] != 1 || result["error"] == "" {
			t.Fatalf("expected failed result envelope, got %#v", result)
		}
	})
}

func TestRuntimeBridgeRegistersControlSender(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
IFS= read -r control
echo '{"type":"result","requestId":"run_session_1","result":{"ok":true}}'
`)
	var controlErr error
	result, err := (Bridge{}).Run(context.Background(), Request{
		Runtime:   "codex",
		SessionID: "session_1",
		WorkDir:   t.TempDir(),
		RegisterControlSender: func(send func(BridgeControlFrame) error) {
			controlErr = send(BridgeControlFrame(`{"type":"send","message":"continue"}`))
			if err := send(BridgeControlFrame(`[]`)); err == nil {
				t.Fatal("expected invalid control frame error")
			}
		},
	}, func(JSON) error { return nil })
	if err != nil || controlErr != nil || result["ok"] != true {
		t.Fatalf("expected control sender success, result=%#v controlErr=%v err=%v", result, controlErr, err)
	}
}

func TestRuntimeBridgeInventoryUsesBridgeRequest(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{"type":"result","requestId":"inventory","result":{"runtimes":[{"runtime":"codex","binary":"codex","installed":true,"models":["gpt-5"],"fallbackModels":["gpt-4"],"status":"ready","version":"1.0.0","usageWindows":[{"label":"today","inputTokens":1,"outputTokens":2}]}]}}'
`)
	snapshot, err := (Bridge{}).Inventory(context.Background(), true)
	if err != nil {
		t.Fatalf("expected inventory success, got %v", err)
	}
	if len(snapshot.Runtimes) != 1 || snapshot.Runtimes[0].Runtime != "codex" || !snapshot.Runtimes[0].Installed ||
		len(snapshot.Runtimes[0].UsageWindows) != 1 {
		t.Fatalf("unexpected inventory snapshot: %#v", snapshot)
	}
}

func TestRuntimeBridgeInventoryReportsProtocolErrors(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{"type":"result","requestId":"inventory","result":{"runtimes":[{"binary":"codex"}]}}'
`)
	if _, err := (Bridge{}).Inventory(context.Background(), false); err == nil || !strings.Contains(err.Error(), "missing runtime") {
		t.Fatalf("expected inventory parse error, got %v", err)
	}
}

func TestRuntimeBridgeInventoryReportsReadyFailures(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"not-ready"}'
`)
	if _, err := (Bridge{}).Inventory(context.Background(), false); err == nil || !strings.Contains(err.Error(), "did not send ready") {
		t.Fatalf("expected inventory ready error, got %v", err)
	}
}

func TestRuntimeBridgeInventoryReportsBridgeErrors(t *testing.T) {
	installFakeNode(t, `#!/bin/sh
echo '{"type":"ready"}'
IFS= read -r request
echo '{"type":"error","requestId":"inventory","error":{"message":"inventory failed"}}'
`)
	if _, err := (Bridge{}).Inventory(context.Background(), false); err == nil || !strings.Contains(err.Error(), "inventory failed") {
		t.Fatalf("expected inventory bridge error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentSanitizesRunnerSecrets(t *testing.T) {
	t.Setenv("AMA_TOKEN", "operator-token")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "operator-secret")
	workDir := t.TempDir()
	env, err := commandEnvironment(Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"mode": "test"},
		Provider:      "provider_codex",
		Model:         "gpt-5.3-codex",
		AgentSnapshot: map[string]any{"name": "agent"},
		Env:           map[string]string{"CUSTOM": "value"},
		WorkDir:       workDir,
	})
	if err != nil {
		t.Fatalf("expected runtime env, got %v", err)
	}
	resolvedWorkDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	envText := strings.Join(env, "\n")
	for _, expected := range []string{
		"AMA_SESSION_ID=session_1",
		"AMA_RUNTIME=codex",
		"AMA_PROVIDER=provider_codex",
		"AMA_MODEL=gpt-5.3-codex",
		"AMA_WORKSPACE=" + workDir,
		"AMA_WORKSPACE_HOME=" + filepath.Join(resolvedWorkDir, ".home"),
		`AMA_RUNTIME_CONFIG={"mode":"test"}`,
		`AMA_AGENT_SNAPSHOT={"name":"agent"}`,
		"CUSTOM=value",
	} {
		if !strings.Contains(envText, expected) {
			t.Fatalf("expected env %q in %q", expected, envText)
		}
	}
	for _, leaked := range []string{"operator-token", "operator-secret", "AMA_INITIAL_PROMPT="} {
		if strings.Contains(envText, leaked) {
			t.Fatalf("expected sanitized runtime env, found %q in %q", leaked, envText)
		}
	}
}

func TestRuntimeCommandEnvironmentRejectsUnserializableConfig(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		RuntimeConfig: map[string]any{"bad": make(chan int)},
		WorkDir:       t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected runtime config marshal error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentRejectsUnserializableAgentSnapshot(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID:     "session_1",
		Runtime:       "codex",
		AgentSnapshot: map[string]any{"bad": make(chan int)},
		WorkDir:       t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected agent snapshot marshal error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentRejectsReservedEnv(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID: "session_1",
		Runtime:   "codex",
		Env:       map[string]string{"AMA_SESSION_ID": "override"},
		WorkDir:   t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("expected reserved env error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentRejectsInvalidEnvKey(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID: "session_1",
		Runtime:   "codex",
		Env:       map[string]string{"BAD=KEY": "value"},
		WorkDir:   t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected invalid env key error, got %v", err)
	}
}

func TestRuntimeCommandEnvironmentRejectsEmptyEnvKey(t *testing.T) {
	if _, err := commandEnvironment(Request{
		SessionID: "session_1",
		Runtime:   "codex",
		Env:       map[string]string{"": "value"},
		WorkDir:   t.TempDir(),
	}); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected empty env key error, got %v", err)
	}
}

func TestBridgeStdinRejectsClosedAndUnserializableWrites(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	_ = reader.Close()
	stdin := &bridgeStdin{writer: writer, protocol: bridgeProtocol{}}
	if err := stdin.Close(); err != nil {
		t.Fatalf("close stdin: %v", err)
	}
	if err := stdin.WriteJSON(JSON{"type": "after-close"}); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("expected closed stdin error, got %v", err)
	}
	if err := (&bridgeStdin{writer: writer, protocol: bridgeProtocol{}}).WriteJSON(map[string]any{"bad": func() {}}); err == nil {
		t.Fatal("expected marshal error")
	}
}

func TestBridgeStdinWritesAndHelpers(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	stdin := &bridgeStdin{writer: writer, protocol: bridgeProtocol{}}
	if err := stdin.WriteJSON(JSON{"type": "ping"}); err != nil {
		t.Fatalf("write json: %v", err)
	}
	if err := stdin.Close(); err != nil {
		t.Fatalf("close stdin: %v", err)
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read pipe: %v", err)
	}
	if !strings.Contains(string(data), `"type":"ping"`) {
		t.Fatalf("expected serialized ping, got %q", data)
	}
	_ = reader.Close()

	if got := envMap([]string{"A=1", "NO_EQUALS", "B=two=2"}); got["A"] != "1" || got["B"] != "two=2" {
		t.Fatalf("unexpected env map %#v", got)
	}
	var stderr bytes.Buffer
	if err := streamBridgeStderr(strings.NewReader("one\ntwo\n"), &stderr); err != nil {
		t.Fatalf("stream stderr: %v", err)
	}
	if stderr.String() != "one\ntwo\n" {
		t.Fatalf("unexpected stderr stream %q", stderr.String())
	}
	stderr.Reset()
	largeStderr := strings.Repeat("x", 256*1024)
	if err := streamBridgeStderr(strings.NewReader(largeStderr), &stderr); err != nil {
		t.Fatalf("stream large stderr: %v", err)
	}
	if stderr.String() != largeStderr {
		t.Fatalf("expected full large stderr, got %d bytes", stderr.Len())
	}
}

func TestExitCodeForNonExitError(t *testing.T) {
	if got := exitCode(errors.New("not an exit error")); got != 1 {
		t.Fatalf("expected generic error exit code 1, got %d", got)
	}
}

func TestRuntimeBridgeRuntimeContextFollowsParentCancellation(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	defer cancelParent()
	commandCtx, cancelCommand := Bridge{}.commandContext(parent)
	defer cancelCommand()

	select {
	case <-commandCtx.Done():
		t.Fatal("expected runtime bridge context to ignore per-command timeout")
	case <-time.After(5 * time.Millisecond):
	}

	cancelParent()
	select {
	case <-commandCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("expected runtime bridge context to follow parent cancellation")
	}
}

func TestBridgePipeClosedAfterResultOnlyIgnoresCompletedBridgeClose(t *testing.T) {
	if !bridgePipeClosedAfterResult(os.ErrClosed, JSON{"exitCode": 0}) {
		t.Fatal("expected closed bridge pipe after result to be ignored")
	}
	if bridgePipeClosedAfterResult(os.ErrClosed, nil) {
		t.Fatal("expected closed bridge pipe before result to remain fatal")
	}
	if bridgePipeClosedAfterResult(errors.New("bridge failed"), JSON{"exitCode": 0}) {
		t.Fatal("expected non-close bridge errors to remain fatal")
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
