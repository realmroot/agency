//go:build !windows

package userdirs

import (
	"path/filepath"
	"testing"
)

func TestUnixPrefersXDGDirectories(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "/config")
	t.Setenv("XDG_STATE_HOME", "/state")
	t.Setenv("HOME", "/home/runner")
	if got := ConfigFile("ama-runner", "config.json"); got != filepath.Join("/config", "ama-runner", "config.json") {
		t.Fatalf("expected XDG config path, got %q", got)
	}
	if got := StateDir("ama-runner"); got != filepath.Join("/state", "ama-runner") {
		t.Fatalf("expected XDG state dir, got %q", got)
	}
}

func TestUnixFallsBackToHomeAndCanBeEmpty(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("XDG_STATE_HOME", "")
	t.Setenv("HOME", "/home/runner")
	if got := ConfigFile("ama-runner", "config.json"); got != filepath.Join("/home/runner", ".config", "ama-runner", "config.json") {
		t.Fatalf("expected HOME config path, got %q", got)
	}
	if got := StateDir("ama-runner"); got != filepath.Join("/home/runner", ".local", "state", "ama-runner") {
		t.Fatalf("expected HOME state path, got %q", got)
	}
	t.Setenv("HOME", "")
	if ConfigFile("ama-runner", "config.json") != "" || StateDir("ama-runner") != "" {
		t.Fatal("expected empty defaults without HOME or XDG")
	}
}
