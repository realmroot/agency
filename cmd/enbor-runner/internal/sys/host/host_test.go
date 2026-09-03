package host

import "testing"

func TestCurrentReturnsBuildPlatform(t *testing.T) {
	current := Current()
	if current.OS == "" || current.Arch == "" {
		t.Fatalf("expected host platform, got %#v", current)
	}
}
