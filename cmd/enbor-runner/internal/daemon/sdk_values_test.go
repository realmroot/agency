package daemon

import "testing"

func TestSDKValueHelpers(t *testing.T) {
	value := "value"
	if got := stringValue(&value); got != value {
		t.Fatalf("expected string value %q, got %q", value, got)
	}
	if got := stringValue(nil); got != "" {
		t.Fatalf("expected empty string for nil pointer, got %q", got)
	}
}
