//go:build windows

package userdirs

import (
	"path/filepath"
	"testing"
)

func TestWindowsUsesNativeUserDirectories(t *testing.T) {
	appData := filepath.Join(t.TempDir(), "Roaming Profile")
	localAppData := filepath.Join(t.TempDir(), "Local Profile")
	t.Setenv("APPDATA", appData)
	t.Setenv("LOCALAPPDATA", localAppData)
	if got := ConfigFile("ama-runner", "config.json"); got != filepath.Join(appData, "ama-runner", "config.json") {
		t.Fatalf("unexpected config path %q", got)
	}
	if got := StateDir("ama-runner"); got != filepath.Join(localAppData, "ama-runner") {
		t.Fatalf("unexpected state path %q", got)
	}
}
