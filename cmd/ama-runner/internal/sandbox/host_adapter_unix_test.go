//go:build !windows

package sandbox

import (
	"testing"
	"time"
)

func TestUnixHostAdapterUsesProcessAdapter(t *testing.T) {
	commandTimeout := 3 * time.Second
	shutdownGraceInterval := 2 * time.Second
	adapter, ok := NewHostAdapter(commandTimeout, shutdownGraceInterval).(ProcessAdapter)
	if !ok {
		t.Fatalf("expected process adapter, got %T", adapter)
	}
	if adapter.CommandTimeout != commandTimeout || adapter.ShutdownGraceInterval != shutdownGraceInterval {
		t.Fatalf("unexpected process adapter configuration: %#v", adapter)
	}
	if name := HostAdapterName(); name != ProcessUnsafeAdapterName {
		t.Fatalf("unexpected host adapter name %q", name)
	}
}
