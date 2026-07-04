package runtime

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestBridgeProtocolReadsReadyEventsResultsErrorsAndLogs(t *testing.T) {
	protocol := bridgeProtocol{}
	output := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"resumeToken","requestId":"run_session_1","resumeToken":"thread_1"}`,
		`{"type":"provider.event","requestId":"run_session_1","runtime":"codex","event":{"type":"item.completed","item":{"type":"collab_tool_call"}}}`,
		`{"type":"runtime.event","requestId":"run_session_1","event":{"type":"message.completed","payload":{"message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"ok"}]}}}}`,
		`{"type":"resumeToken","requestId":"other","resumeToken":"ignored"}`,
		`{"type":"runtime.event","requestId":"run_session_1","event":{"type":"runtime.error","payload":{"message":"bridge diagnostic"}}}`,
		`{"type":"provider.event","requestId":"other","runtime":"codex","event":{"type":"ignored"}}`,
		`{"type":"runtime.event","requestId":"other","event":{"type":"message.completed","payload":{"message":{"role":"assistant","content":"ignored"}}}}`,
		`{"type":"result","requestId":"run_session_1","result":{"exitCode":0,"providerThreadId":"thread_1"}}`,
	}, "\n")
	reader := protocol.lineReader(strings.NewReader(output))
	if err := protocol.waitReady(reader); err != nil {
		t.Fatalf("expected bridge ready, got %v", err)
	}
	var events []string
	var providerEvents []string
	var resumeTokens []string
	result, err := protocol.readResult(reader, "run_session_1", func(event JSON) error {
		events = append(events, mustJSON(t, event))
		return nil
	}, func(resumeToken string) error {
		resumeTokens = append(resumeTokens, resumeToken)
		return nil
	}, func(runtimeName string, event JSON) error {
		providerEvents = append(providerEvents, runtimeName+":"+mustJSON(t, event))
		return nil
	})
	if err != nil {
		t.Fatalf("expected bridge messages, got %v", err)
	}
	if len(events) != 2 || !strings.Contains(events[0], "message.completed") || !strings.Contains(events[1], "runtime.error") {
		t.Fatalf("expected forwarded event and log, got %v", events)
	}
	if len(resumeTokens) != 1 || resumeTokens[0] != "thread_1" {
		t.Fatalf("expected scoped resume token callback, got %v", resumeTokens)
	}
	if len(providerEvents) != 1 || !strings.Contains(providerEvents[0], "codex") || !strings.Contains(providerEvents[0], "collab_tool_call") {
		t.Fatalf("expected scoped provider event callback, got %v", providerEvents)
	}
	if result["providerThreadId"] != "thread_1" {
		t.Fatalf("expected bridge result, got %#v", result)
	}
}

func TestBridgeProtocolStopsBeforeEventsWhenResumeTokenPersistFails(t *testing.T) {
	protocol := bridgeProtocol{}
	output := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"resumeToken","requestId":"run_session_1","resumeToken":"thread_1"}`,
		`{"type":"runtime.event","requestId":"run_session_1","event":{"type":"message.completed","payload":{"message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"must not write"}]}}}}`,
		`{"type":"result","requestId":"run_session_1","result":{"exitCode":0}}`,
	}, "\n")
	reader := protocol.lineReader(strings.NewReader(output))
	if err := protocol.waitReady(reader); err != nil {
		t.Fatalf("expected bridge ready, got %v", err)
	}
	persistErr := errors.New("persist resume token failed")
	var events []JSON
	_, err := protocol.readResult(reader, "run_session_1", func(event JSON) error {
		events = append(events, event)
		return nil
	}, func(string) error {
		return persistErr
	}, nil)
	if !errors.Is(err, persistErr) {
		t.Fatalf("expected resume token persist error, got %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("resume token failure must stop before writing events, got %#v", events)
	}
}

func TestBridgeProtocolErrorBranches(t *testing.T) {
	protocol := bridgeProtocol{}
	if err := protocol.waitReady(protocol.lineReader(strings.NewReader(""))); err == nil || !strings.Contains(err.Error(), "exited before ready") {
		t.Fatalf("expected exited-before-ready error, got %v", err)
	}
	if err := protocol.waitReady(protocol.lineReader(strings.NewReader(`{` + "\n"))); err == nil || !strings.Contains(err.Error(), "invalid runtime bridge ready") {
		t.Fatalf("expected invalid ready json error, got %v", err)
	}
	if err := protocol.waitReady(protocol.lineReader(strings.NewReader(`{"type":"log"}` + "\n"))); err == nil || !strings.Contains(err.Error(), "did not send ready") {
		t.Fatalf("expected ready error, got %v", err)
	}
	reader := protocol.lineReader(strings.NewReader(strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"runtime.event","requestId":"run_session_1","event":{"payload":{}}}`,
	}, "\n")))
	if err := protocol.waitReady(reader); err != nil {
		t.Fatal(err)
	}
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "missing type") {
		t.Fatalf("expected missing event type error, got %v", err)
	}
	reader = protocol.lineReader(strings.NewReader(`{"type":"runtime.event","requestId":"run_session_1"}` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "missing body") {
		t.Fatalf("expected missing event body error, got %v", err)
	}
	reader = protocol.lineReader(strings.NewReader(`{"type":"error","requestId":"run_session_1","error":{"message":"sdk failed"}}` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "sdk failed") {
		t.Fatalf("expected bridge error, got %v", err)
	}
	reader = protocol.lineReader(strings.NewReader(`{"type":"error","requestId":"run_session_1","error":{}}` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "runtime bridge failed") {
		t.Fatalf("expected default bridge error, got %v", err)
	}
	reader = protocol.lineReader(strings.NewReader(`{` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "invalid runtime bridge message") {
		t.Fatalf("expected invalid message json error, got %v", err)
	}
	reader = protocol.lineReader(strings.NewReader(`{"type":"log","requestId":"run_session_1"}` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "unsupported runtime bridge message") {
		t.Fatalf("expected unsupported message error, got %v", err)
	}
	writeErr := errors.New("write failed")
	reader = protocol.lineReader(strings.NewReader(`{"type":"runtime.event","requestId":"run_session_1","event":{"type":"runtime.error","payload":{"message":"diag"}}}` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return writeErr }, nil, nil); !errors.Is(err, writeErr) {
		t.Fatalf("expected writer error, got %v", err)
	}
	reader = protocol.lineReader(strings.NewReader(`{"type":"runtime.event","requestId":"other","event":{"type":"message.completed","payload":{}}}` + "\n"))
	if _, err := protocol.readResult(reader, "run_session_1", func(JSON) error { return nil }, nil, nil); err == nil || !strings.Contains(err.Error(), "exited before result") {
		t.Fatalf("expected missing result error, got %v", err)
	}
}

func TestBridgeProtocolReadsLargeNativeRuntimeEvents(t *testing.T) {
	// [spec: runtime/large-bridge-events]
	protocol := bridgeProtocol{}
	largeText := strings.Repeat("x", 2*1024*1024)
	output := strings.Join([]string{
		`{"type":"ready"}`,
		`{"type":"runtime.event","requestId":"run_session_1","event":{"type":"message.completed","payload":{"text":"` + largeText + `"}}}`,
		`{"type":"result","requestId":"run_session_1","result":{"exitCode":0}}`,
	}, "\n")
	reader := protocol.lineReader(strings.NewReader(output))
	if err := protocol.waitReady(reader); err != nil {
		t.Fatalf("expected bridge ready, got %v", err)
	}
	var event JSON
	result, err := protocol.readResult(reader, "run_session_1", func(value JSON) error {
		event = value
		return nil
	}, nil, nil)
	if err != nil {
		t.Fatalf("expected large native event to pass through, got %v", err)
	}
	payload, ok := event["payload"].(map[string]any)
	if !ok || len(payload["text"].(string)) != len(largeText) {
		t.Fatalf("expected full large payload, got %#v", event["payload"])
	}
	if result["exitCode"] != float64(0) {
		t.Fatalf("expected bridge result, got %#v", result)
	}
}

func TestBridgeProtocolControlFrame(t *testing.T) {
	got, err := bridgeProtocol{}.controlFrame("run_1", BridgeControlFrame(`{"type":"permissionDecision","permissionId":"perm_1","allowed":true,"reason":"ok","nested":{"keep":true}}`))
	if err != nil {
		t.Fatalf("expected control frame, got %v", err)
	}
	data, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(data)
	for _, expected := range []string{`"requestId":"run_1"`, `"permissionId":"perm_1"`, `"allowed":true`, `"nested":{"keep":true}`} {
		if !strings.Contains(serialized, expected) {
			t.Fatalf("expected %s in control frame %s", expected, serialized)
		}
	}
}

func TestBridgeProtocolEncodeLine(t *testing.T) {
	line, err := bridgeProtocol{}.encodeLine(JSON{"type": "run"})
	if err != nil {
		t.Fatalf("expected encoded line, got %v", err)
	}
	if string(line) != "{\"type\":\"run\"}\n" {
		t.Fatalf("unexpected encoded line %q", string(line))
	}
	if _, err := (bridgeProtocol{}).encodeLine(map[string]any{"bad": func() {}}); err == nil {
		t.Fatal("expected marshal error")
	}
}

func TestBridgeProtocolRejectsInvalidControlFrame(t *testing.T) {
	if got, err := (bridgeProtocol{}).controlFrame("run_1", BridgeControlFrame(`[]`)); err == nil || got != nil {
		t.Fatalf("unexpected control frame %#v", got)
	}
	if got, err := (bridgeProtocol{}).controlFrame("run_1", BridgeControlFrame(`{`)); err == nil || got != nil {
		t.Fatalf("unexpected invalid-json control frame %#v", got)
	}
}

func TestBridgeProtocolParsesInventorySnapshot(t *testing.T) {
	snapshot, err := bridgeProtocol{}.inventorySnapshot(JSON{
		"runtimes": []any{
			map[string]any{
				"runtime":        "codex",
				"binary":         "codex",
				"installed":      true,
				"fallbackModels": []any{"gpt-5.3-codex"},
				"models":         []any{"gpt-5.3-codex", "gpt-5.3-codex-mini"},
				"status":         "ready",
				"version":        "bridge-test",
				"detail":         "ready",
				"usageWindows": []any{
					map[string]any{"label": "5-Hour", "utilization": 50, "resetsAt": "2026-01-01T00:00:00Z"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("expected inventory snapshot, got %v", err)
	}
	if len(snapshot.Runtimes) != 1 || snapshot.Runtimes[0].Runtime != "codex" {
		t.Fatalf("unexpected snapshot %#v", snapshot)
	}
	if len(snapshot.Runtimes[0].Models) != 2 || len(snapshot.Runtimes[0].UsageWindows) != 1 {
		t.Fatalf("expected parsed models and usage windows, got %#v", snapshot.Runtimes[0])
	}
}

func TestBridgeProtocolRejectsInventorySnapshotMissingRuntime(t *testing.T) {
	_, err := bridgeProtocol{}.inventorySnapshot(JSON{"runtimes": []any{map[string]any{"binary": "codex"}}})
	if err == nil || !strings.Contains(err.Error(), "missing runtime") {
		t.Fatalf("expected missing runtime error, got %v", err)
	}
}

func TestBridgeProtocolRejectsInvalidInventorySnapshot(t *testing.T) {
	protocol := bridgeProtocol{}
	if _, err := protocol.inventorySnapshot(JSON{"runtimes": make(chan int)}); err == nil || !strings.Contains(err.Error(), "unsupported type") {
		t.Fatalf("expected inventory marshal error, got %v", err)
	}
	if _, err := protocol.inventorySnapshot(JSON{"runtimes": "invalid"}); err == nil || !strings.Contains(err.Error(), "cannot unmarshal") {
		t.Fatalf("expected inventory unmarshal error, got %v", err)
	}
}
