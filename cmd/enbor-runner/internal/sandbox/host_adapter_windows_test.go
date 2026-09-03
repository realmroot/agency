//go:build windows

package sandbox

import "testing"

func TestWindowsHasNoEnborHostAdapter(t *testing.T) {
	if adapter := NewHostAdapter(0, 0); adapter != nil {
		t.Fatalf("expected no Windows Enbor host adapter, got %T", adapter)
	}
	if HostAdapterName() != "none" {
		t.Fatalf("unexpected Windows host adapter %q", HostAdapterName())
	}
}
