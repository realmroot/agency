package sessionevent

import "testing"

func TestIsCanonicalEventType(t *testing.T) {
	if !IsCanonicalEventType(string(EventTypeRuntimeStarted)) {
		t.Fatal("expected runtime.started to be canonical")
	}
	if IsCanonicalEventType("runtime.paused") {
		t.Fatal("expected unknown event type to be rejected")
	}
}
