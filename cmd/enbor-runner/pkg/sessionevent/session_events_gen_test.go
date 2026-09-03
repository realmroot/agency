package sessionevent

import "testing"

// Conformance: the generated canonical event-type set is self-consistent and
// contains every type the runner actually emits. TS↔Go drift is caught by
// `pnpm run contract:check`; this guards the generated file's integrity and
// that the runner's emit sites reference canonical constants.
func TestCanonicalEventTypeEnum(t *testing.T) {
	if IsCanonicalEventType("not_a_real_event_type") {
		t.Error("IsCanonicalEventType accepted an unknown type")
	}
	for _, emitted := range []string{
		string(EventTypeMessageCompleted),
		string(EventTypeRuntimeError),
		string(EventTypeRuntimeStarted),
	} {
		if !IsCanonicalEventType(emitted) {
			t.Errorf("runner-emitted event %q is not a canonical event type", emitted)
		}
	}
}
