//go:build windows

package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestWindowsChmodProvidesReadOnlyFileBehavior(t *testing.T) {
	path := filepath.Join(t.TempDir(), "memory.txt")
	if err := os.WriteFile(path, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o400); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("blocked"), 0o600); err == nil {
		t.Fatal("expected Windows read-only attribute to reject a write")
	}
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("after"), 0o600); err != nil {
		t.Fatalf("expected restored writable file: %v", err)
	}
}

func TestWindowsJunctionEscapeIsRejected(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	junction := filepath.Join(root, "junction")
	if output, err := exec.Command("cmd.exe", "/d", "/s", "/c", "mklink /J \""+junction+"\" \""+outside+"\"").CombinedOutput(); err != nil {
		t.Fatalf("create junction: %v: %s", err, output)
	}
	resolved, err := filepath.EvalSymlinks(junction)
	if err != nil {
		t.Fatal(err)
	}
	if err := ensureUnderWorkspace(root, resolved); err == nil {
		t.Fatal("expected junction outside workspace to be rejected")
	}
}
