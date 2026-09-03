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
	if got := ConfigFile("enbor-runner", "config.json"); got != filepath.Join(appData, "enbor-runner", "config.json") {
		t.Fatalf("unexpected config path %q", got)
	}
	if got := StateDir("enbor-runner"); got != filepath.Join(localAppData, "enbor-runner") {
		t.Fatalf("unexpected state path %q", got)
	}
}
