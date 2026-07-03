package session

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

func TestEventLogAppendReadAllAndReopen(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenEventLog(dir, "session_1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for i, typ := range []string{"a", "b", "c"} {
		event, err := store.Append(ama.JSON{"type": typ, "payload": ama.JSON{"i": i}})
		if err != nil {
			t.Fatalf("append: %v", err)
		}
		if event.Sequence != int64(i+1) {
			t.Fatalf("sequence = %d, want %d", event.Sequence, i+1)
		}
		if event.ID == "" {
			t.Fatal("append assigned an empty id")
		}
		if event.SessionID != "session_1" {
			t.Fatalf("append assigned session = %s, want session_1", event.SessionID)
		}
	}

	events, err := store.ReadAll()
	if err != nil {
		t.Fatalf("readall: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("len = %d, want 3", len(events))
	}
	if events[0].Type != "a" || events[2].Type != "c" {
		t.Fatalf("order wrong: %s..%s", events[0].Type, events[2].Type)
	}
	if amaEvent := events[0].AmaEvent(); amaEvent["type"] != "a" || amaEvent["payload"] == nil {
		t.Fatalf("unexpected AMA event projection %#v", amaEvent)
	}
	if events[0].Sequence != 1 || events[2].Sequence != 3 {
		t.Fatalf("sequences = %d,%d want 1,3", events[0].Sequence, events[2].Sequence)
	}

	// Reopening recovers the sequence so a resumed run keeps counting up rather
	// than restarting (the on-disk log is the source of truth).
	reopened, err := OpenEventLog(dir, "session_1")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	event, err := reopened.Append(ama.JSON{"type": "d", "payload": ama.JSON{}})
	if err != nil {
		t.Fatalf("append after reopen: %v", err)
	}
	if event.Sequence != 4 {
		t.Fatalf("reopened sequence = %d, want 4", event.Sequence)
	}
	if _, err := os.Stat(filepath.Join(dir, "events.jsonl")); err != nil {
		t.Fatalf("durable log missing: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "events.jsonl"))
	if err != nil {
		t.Fatalf("read durable log: %v", err)
	}
	if strings.Contains(string(raw), `"event"`) {
		t.Fatalf("event log must use flattened SessionEvent records, got %s", string(raw))
	}
}

func TestReadEventLogReturnsNilForMissingFile(t *testing.T) {
	events, err := ReadEventLog(filepath.Join(t.TempDir(), "nonexistent.jsonl"))
	if err != nil {
		t.Fatalf("missing log file must not error, got %v", err)
	}
	if events != nil {
		t.Fatalf("missing log file must return nil events, got %v", events)
	}
}

func TestEventLogAppendCoordinatesSequenceAcrossOpenStores(t *testing.T) {
	dir := t.TempDir()
	first, err := OpenEventLog(dir, "session_1")
	if err != nil {
		t.Fatalf("open first: %v", err)
	}
	second, err := OpenEventLog(dir, "session_1")
	if err != nil {
		t.Fatalf("open second: %v", err)
	}
	if event, err := first.Append(ama.JSON{"type": "message.completed", "payload": ama.JSON{"writer": "first"}}); err != nil || event.Sequence != 1 {
		t.Fatalf("first append sequence = %d err=%v, want 1", event.Sequence, err)
	}
	if event, err := second.Append(ama.JSON{"type": "message.completed", "payload": ama.JSON{"writer": "second"}}); err != nil || event.Sequence != 2 {
		t.Fatalf("second append sequence = %d err=%v, want 2", event.Sequence, err)
	}
	if event, err := first.Append(ama.JSON{"type": "message.completed", "payload": ama.JSON{"writer": "first"}}); err != nil || event.Sequence != 3 {
		t.Fatalf("third append sequence = %d err=%v, want 3", event.Sequence, err)
	}
}

func TestEventLogReadsEventsLargerThanOldScannerLimit(t *testing.T) {
	store, err := OpenEventLog(t.TempDir(), "session_1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	largeText := strings.Repeat("x", 17*1024*1024)
	if _, err := store.Append(ama.JSON{"type": "message.completed", "payload": ama.JSON{"text": largeText}}); err != nil {
		t.Fatalf("append large event: %v", err)
	}
	events, err := store.ReadAll()
	if err != nil {
		t.Fatalf("read large event: %v", err)
	}
	if len(events) != 1 || events[0].Payload["text"] != largeText {
		t.Fatalf("expected full large event, got %d events", len(events))
	}
}

func TestEventLogAppendValidatesTypeAndNormalizesPayload(t *testing.T) {
	store, err := OpenEventLog(t.TempDir(), "session_1")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := store.Append(ama.JSON{"payload": ama.JSON{}}); err == nil || !strings.Contains(err.Error(), "missing type") {
		t.Fatalf("expected missing type error, got %v", err)
	}
	if _, err := store.Append(ama.JSON{"type": ""}); err == nil || !strings.Contains(err.Error(), "missing type") {
		t.Fatalf("expected empty type error, got %v", err)
	}
	event, err := store.Append(ama.JSON{"type": "tool.result", "payload": map[string]any{"toolCallId": "call_1"}})
	if err != nil {
		t.Fatalf("append map payload: %v", err)
	}
	if event.Sequence != 3 {
		t.Fatalf("sequence should advance for each append attempt, got %d", event.Sequence)
	}
	if event.Payload["toolCallId"] != "call_1" {
		t.Fatalf("expected normalized payload, got %#v", event.Payload)
	}
	event, err = store.Append(ama.JSON{"type": "message.completed", "payload": "ignored"})
	if err != nil {
		t.Fatalf("append scalar payload: %v", err)
	}
	if len(event.Payload) != 0 {
		t.Fatalf("expected scalar payload to normalize to empty object, got %#v", event.Payload)
	}
}

func TestEventLogReportsInvalidAndUnwritableLogs(t *testing.T) {
	dir := t.TempDir()
	logPath := EventLogPath(dir)
	if err := os.WriteFile(logPath, []byte("not json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenEventLog(dir, "session_1"); err == nil || !strings.Contains(err.Error(), "line 1") {
		t.Fatalf("expected invalid log error, got %v", err)
	}

	if _, err := OpenEventLog(filepath.Join(logPath, "child"), "session_1"); err == nil {
		t.Fatal("expected open under file path to fail")
	}
	store := &EventLog{path: filepath.Join(logPath, "child.jsonl"), sessionID: "session_1"}
	if _, err := store.Append(ama.JSON{"type": "message.completed"}); err == nil {
		t.Fatal("expected append under file path to fail")
	}
	if _, err := (&EventLog{path: filepath.Join(t.TempDir(), "events.jsonl"), sessionID: "session_1"}).Append(ama.JSON{"bad": func() {}}); err == nil {
		t.Fatal("expected append marshal error")
	}
}
