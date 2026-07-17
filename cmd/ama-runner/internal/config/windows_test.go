//go:build windows

package config

import (
	"path/filepath"
	"testing"
	"time"
)

func TestWindowsDefaultPathsUseNativeUserDirectories(t *testing.T) {
	appData := filepath.Join(t.TempDir(), "Roaming Profile")
	localAppData := filepath.Join(t.TempDir(), "Local Profile")
	t.Setenv("APPDATA", appData)
	t.Setenv("LOCALAPPDATA", localAppData)
	if got := DefaultConfigPath(); got != filepath.Join(appData, "ama-runner", "config.json") {
		t.Fatalf("unexpected Windows config path %q", got)
	}
	if got := DefaultCredentialPath(); got != filepath.Join(appData, "ama-runner", "credentials.json") {
		t.Fatalf("unexpected Windows credential path %q", got)
	}
	if got := DefaultStateDir(); got != filepath.Join(localAppData, "ama-runner") {
		t.Fatalf("unexpected Windows state path %q", got)
	}
}

func TestWindowsCredentialLockSerializesWriters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	locked := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- withCredentialStoreLock(path, func() error {
			close(locked)
			<-release
			return nil
		})
	}()
	<-locked
	second := make(chan error, 1)
	go func() {
		second <- withCredentialStoreLock(path, func() error { return nil })
	}()
	select {
	case err := <-second:
		t.Fatalf("second credential lock completed before release: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := <-second; err != nil {
		t.Fatal(err)
	}
}
