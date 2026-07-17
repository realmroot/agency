//go:build windows

package daemon

import (
	"path/filepath"
	"testing"
)

func TestWindowsRunnerReportsOnlyDetectedRuntimes(t *testing.T) { // [spec: runners/heartbeat]
	if supportsAMARuntime() {
		t.Fatal("Windows must not support the AMA runtime")
	}
	got := runnerCapabilities([]string{"codex", "claude-code", "copilot"}, supportsAMARuntime())
	if len(got) != 3 || got[0] != "codex" || got[1] != "claude-code" || got[2] != "copilot" {
		t.Fatalf("unexpected Windows runtime capabilities %v", got)
	}
	if sandboxAdapterName() != "none" {
		t.Fatalf("unexpected Windows sandbox adapter %q", sandboxAdapterName())
	}
}

func TestWindowsStateDirectoryLockRejectsSecondDaemon(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "runner state")
	release, err := acquireStateDirLock(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err := acquireStateDirLock(stateDir); err == nil {
		t.Fatal("expected second daemon lock to fail")
	}
}
