//go:build !windows

package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCleanupStalePropagatesFilesystemPermissionErrors(t *testing.T) {
	t.Run("stat session root", func(t *testing.T) {
		parent := t.TempDir()
		root := filepath.Join(parent, "session_inaccessible")
		if err := os.Chmod(parent, 0o000); err != nil {
			t.Fatal(err)
		}
		err := cleanupStaleSessionArtifacts(root)
		if restoreErr := os.Chmod(parent, 0o755); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil {
			t.Fatal("expected inaccessible session root parent to fail stat")
		}
	})

	t.Run("read session root", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "session_inaccessible")
		if err := os.Mkdir(root, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(root, 0o000); err != nil {
			t.Fatal(err)
		}
		err := cleanupStaleSessionArtifacts(root)
		if restoreErr := os.Chmod(root, 0o755); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil {
			t.Fatal("expected unreadable session root to fail directory read")
		}
	})

	t.Run("stat sessions path", func(t *testing.T) {
		workDir := t.TempDir()
		if err := os.Mkdir(filepath.Join(workDir, SessionsDirName), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(workDir, 0o000); err != nil {
			t.Fatal(err)
		}
		err := CleanupStale(context.Background(), workDir, time.Hour)
		if restoreErr := os.Chmod(workDir, 0o755); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil {
			t.Fatal("expected inaccessible work directory to fail sessions path inspection")
		}
	})

	t.Run("read sessions directory", func(t *testing.T) {
		workDir := t.TempDir()
		sessionsDir := filepath.Join(workDir, SessionsDirName)
		if err := os.Mkdir(sessionsDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(sessionsDir, 0o000); err != nil {
			t.Fatal(err)
		}
		err := CleanupStale(context.Background(), workDir, time.Hour)
		if restoreErr := os.Chmod(sessionsDir, 0o755); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil {
			t.Fatal("expected unreadable sessions directory to fail cleanup")
		}
	})

	t.Run("remove disposable artifact", func(t *testing.T) {
		workDir := t.TempDir()
		root := filepath.Join(workDir, SessionsDirName, "session_locked")
		if err := os.MkdirAll(filepath.Join(root, ".tmp"), 0o755); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-2 * time.Hour)
		if err := os.Chtimes(root, old, old); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(root, 0o500); err != nil {
			t.Fatal(err)
		}
		err := CleanupStale(context.Background(), workDir, time.Hour)
		if restoreErr := os.Chmod(root, 0o755); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil || !strings.Contains(err.Error(), "remove stale session artifacts") {
			t.Fatalf("expected disposable artifact removal error, got %v", err)
		}
	})

	t.Run("remove empty session root", func(t *testing.T) {
		parent := t.TempDir()
		root := filepath.Join(parent, "session_empty")
		if err := os.Mkdir(root, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(parent, 0o500); err != nil {
			t.Fatal(err)
		}
		err := cleanupStaleSessionArtifacts(root)
		if restoreErr := os.Chmod(parent, 0o755); restoreErr != nil {
			t.Fatal(restoreErr)
		}
		if err == nil {
			t.Fatal("expected empty session root removal to propagate parent permission error")
		}
	})
}
