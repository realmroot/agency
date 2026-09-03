package workspace_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	enbor "github.com/realmroot/enbor/sdk/go/enbor"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/session"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/workspace"
)

func TestCleanupStalePreservesDurableSessionHistory(t *testing.T) {
	// [spec: runtime/session-history-retention]
	workDir := t.TempDir()
	sessionRoot := sessionRoot(workDir, "session_with_history")

	eventLog, err := session.OpenEventLog(sessionRoot, "session_with_history")
	if err != nil {
		t.Fatalf("open canonical event log: %v", err)
	}
	if _, err := eventLog.Append(enbor.JSON{
		"type":    "assistant.message",
		"payload": enbor.JSON{"text": "retained transcript"},
	}); err != nil {
		t.Fatalf("append canonical event: %v", err)
	}
	if _, err := session.AppendProviderEvent(sessionRoot, "codex", enbor.JSON{
		"type": "turn.completed",
	}); err != nil {
		t.Fatalf("append provider event: %v", err)
	}

	disposable := []string{
		filepath.Join(sessionRoot, workspace.WorkspaceDirName, "repo", "work.txt"),
		filepath.Join(sessionRoot, ".home", "config.json"),
		filepath.Join(sessionRoot, ".tmp", "runtime.sock"),
		filepath.Join(sessionRoot, workspace.SessionStateFileName),
		filepath.Join(sessionRoot, ".git-clone-credentials"),
	}
	for _, path := range disposable {
		writeFile(t, path, []byte("disposable"))
	}
	unknown := map[string][]byte{
		filepath.Join(sessionRoot, "diagnostic.dump"):          []byte("unknown file evidence"),
		filepath.Join(sessionRoot, "diagnostics", "trace.txt"): []byte("unknown directory evidence"),
	}
	for path, content := range unknown {
		writeFile(t, path, content)
	}

	eventPath := session.EventLogPath(sessionRoot)
	providerPath := session.ProviderEventLogPath(sessionRoot)
	expectedEvents := readFile(t, eventPath)
	expectedProviderEvents := readFile(t, providerPath)
	markStale(t, sessionRoot)

	cleanupStale(t, workDir)
	for _, path := range disposable {
		assertMissing(t, path)
	}
	for path, content := range unknown {
		assertFileContent(t, path, content)
	}
	assertFileContent(t, eventPath, expectedEvents)
	assertFileContent(t, providerPath, expectedProviderEvents)
	assertReadableHistory(t, eventPath, providerPath)

	// Force the retained root through the active cleanup path again rather than
	// relying on its recently changed directory timestamp to make cleanup a no-op.
	markStale(t, sessionRoot)
	cleanupStale(t, workDir)
	assertFileContent(t, eventPath, expectedEvents)
	assertFileContent(t, providerPath, expectedProviderEvents)
	assertReadableHistory(t, eventPath, providerPath)
}

func TestCleanupStaleRetriesFailedWorktreeCleanupWithoutDiscardingSessionEvidence(t *testing.T) {
	workDir := t.TempDir()
	root := sessionRoot(workDir, "session_retry")
	workspaceRoot := filepath.Join(root, workspace.WorkspaceDirName)
	worktreePath := filepath.Join(workspaceRoot, "repo")
	cacheDir := filepath.Join(workDir, "repositories", "github.com", "saltbo", "slink")
	writeFile(t, filepath.Join(worktreePath, "work.txt"), []byte("workspace evidence"))
	writeFile(t, filepath.Join(cacheDir, ".git", "HEAD"), []byte("ref: refs/heads/main\n"))

	state, err := json.Marshal(map[string]any{
		"volumes": []map[string]any{{
			"type":      "git_repository",
			"url":       "https://github.com/saltbo/slink.git",
			"localPath": worktreePath,
		}},
	})
	if err != nil {
		t.Fatalf("encode session state: %v", err)
	}
	statePath := filepath.Join(root, workspace.SessionStateFileName)
	writeFile(t, statePath, state)
	disposable := map[string][]byte{
		filepath.Join(root, ".home", "config.json"):   []byte("home evidence"),
		filepath.Join(root, ".tmp", "runtime.sock"):   []byte("temporary evidence"),
		filepath.Join(root, ".git-clone-credentials"): []byte("credential evidence"),
	}
	for path, content := range disposable {
		writeFile(t, path, content)
	}
	unknownPath := filepath.Join(root, "runner-diagnostic.txt")
	writeFile(t, unknownPath, []byte("diagnostic evidence"))

	eventLog, err := session.OpenEventLog(root, "session_retry")
	if err != nil {
		t.Fatalf("open canonical event log: %v", err)
	}
	if _, err := eventLog.Append(enbor.JSON{"type": "assistant.message", "payload": enbor.JSON{"text": "retry history"}}); err != nil {
		t.Fatalf("append canonical event: %v", err)
	}
	if _, err := session.AppendProviderEvent(root, "codex", enbor.JSON{"type": "turn.completed"}); err != nil {
		t.Fatalf("append provider event: %v", err)
	}
	eventPath := session.EventLogPath(root)
	providerPath := session.ProviderEventLogPath(root)
	expectedEvents := readFile(t, eventPath)
	expectedProviderEvents := readFile(t, providerPath)

	failureMarker := installRetryableScriptedGit(t)
	markStale(t, root)
	if err := workspace.CleanupStale(context.Background(), workDir, time.Hour); err == nil {
		t.Fatal("expected scripted worktree cleanup failure")
	}

	assertFileContent(t, filepath.Join(worktreePath, "work.txt"), []byte("workspace evidence"))
	assertFileContent(t, statePath, state)
	for path, content := range disposable {
		assertFileContent(t, path, content)
	}
	assertFileContent(t, unknownPath, []byte("diagnostic evidence"))
	assertFileContent(t, eventPath, expectedEvents)
	assertFileContent(t, providerPath, expectedProviderEvents)
	assertReadableRetryHistory(t, eventPath, providerPath)

	if err := os.Remove(failureMarker); err != nil {
		t.Fatalf("repair scripted git: %v", err)
	}
	markStale(t, root)
	cleanupStale(t, workDir)

	assertMissing(t, workspaceRoot)
	assertMissing(t, statePath)
	for path := range disposable {
		assertMissing(t, path)
	}
	assertFileContent(t, unknownPath, []byte("diagnostic evidence"))
	assertFileContent(t, eventPath, expectedEvents)
	assertFileContent(t, providerPath, expectedProviderEvents)
	assertReadableRetryHistory(t, eventPath, providerPath)
}

func TestCleanupStalePreservesEitherDurableSessionLog(t *testing.T) {
	tests := []struct {
		name      string
		createLog func(*testing.T, string)
		logName   string
	}{
		{
			name: "canonical event log",
			createLog: func(t *testing.T, root string) {
				store, err := session.OpenEventLog(root, "session_one_log")
				if err != nil {
					t.Fatalf("open canonical event log: %v", err)
				}
				if _, err := store.Append(enbor.JSON{"type": "session.completed", "payload": enbor.JSON{}}); err != nil {
					t.Fatalf("append canonical event: %v", err)
				}
			},
			logName: "events.jsonl",
		},
		{
			name: "provider event log",
			createLog: func(t *testing.T, root string) {
				if _, err := session.AppendProviderEvent(root, "claude-code", enbor.JSON{"type": "result"}); err != nil {
					t.Fatalf("append provider event: %v", err)
				}
			},
			logName: "provider-events.jsonl",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			workDir := t.TempDir()
			root := sessionRoot(workDir, "session_one_log")
			tt.createLog(t, root)
			logPath := filepath.Join(root, tt.logName)
			expected := readFile(t, logPath)
			writeFile(t, filepath.Join(root, ".tmp", "discard"), []byte("discard"))
			markStale(t, root)

			cleanupStale(t, workDir)

			assertFileContent(t, logPath, expected)
			entries, err := os.ReadDir(root)
			if err != nil {
				t.Fatalf("read retained session root: %v", err)
			}
			if len(entries) != 1 || entries[0].Name() != tt.logName {
				t.Fatalf("retained entries = %#v, want only %q", entryNames(entries), tt.logName)
			}
		})
	}
}

func TestCleanupStaleDoesNotRetainLookalikeSessionLogs(t *testing.T) {
	t.Run("directory", func(t *testing.T) {
		workDir := t.TempDir()
		root := sessionRoot(workDir, "session_directory_log")
		writeFile(t, filepath.Join(root, "events.jsonl", "nested"), []byte("not a log"))
		markStale(t, root)

		cleanupStale(t, workDir)

		assertMissing(t, root)
	})

	t.Run("symbolic link", func(t *testing.T) {
		workDir := t.TempDir()
		root := sessionRoot(workDir, "session_symlink_log")
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatalf("create session root: %v", err)
		}
		target := filepath.Join(t.TempDir(), "outside-provider-events.jsonl")
		writeFile(t, target, []byte("outside history"))
		if err := os.Symlink(target, filepath.Join(root, "provider-events.jsonl")); err != nil {
			t.Skipf("symbolic links are unavailable: %v", err)
		}
		markStale(t, root)

		cleanupStale(t, workDir)

		assertMissing(t, root)
		assertFileContent(t, target, []byte("outside history"))
	})
}

func TestCleanupStaleRemovesHistorylessRootAndLeavesRecentSessionUntouched(t *testing.T) {
	workDir := t.TempDir()
	oldRoot := sessionRoot(workDir, "session_without_history")
	writeFile(t, filepath.Join(oldRoot, workspace.WorkspaceDirName, "discard"), []byte("old"))
	writeFile(t, filepath.Join(oldRoot, workspace.SessionStateFileName), []byte("{}"))
	markStale(t, oldRoot)

	recentRoot := sessionRoot(workDir, "session_recent")
	recentPaths := map[string][]byte{
		filepath.Join(recentRoot, workspace.WorkspaceDirName, "active"): []byte("active workspace"),
		filepath.Join(recentRoot, workspace.SessionStateFileName):       []byte("recent state"),
		filepath.Join(recentRoot, "events.jsonl"):                       []byte("recent history"),
	}
	for path, content := range recentPaths {
		writeFile(t, path, content)
	}

	cleanupStale(t, workDir)

	assertMissing(t, oldRoot)
	for path, content := range recentPaths {
		assertFileContent(t, path, content)
	}
}

func cleanupStale(t *testing.T, workDir string) {
	t.Helper()
	if err := workspace.CleanupStale(context.Background(), workDir, time.Hour); err != nil {
		t.Fatalf("cleanup stale runtime workspaces: %v", err)
	}
}

func sessionRoot(workDir string, sessionID string) string {
	return filepath.Join(workDir, workspace.SessionsDirName, sessionID)
}

func markStale(t *testing.T, path string) {
	t.Helper()
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatalf("mark %s stale: %v", path, err)
	}
}

func writeFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create parent for %s: %v", path, err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func readFile(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return content
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("%s should be removed, got %v", path, err)
	}
}

func assertFileContent(t *testing.T, path string, expected []byte) {
	t.Helper()
	content := readFile(t, path)
	if string(content) != string(expected) {
		t.Fatalf("%s content changed: got %q, want %q", path, content, expected)
	}
}

func assertReadableHistory(t *testing.T, eventPath string, providerPath string) {
	t.Helper()
	events, err := session.ReadEventLog(eventPath)
	if err != nil {
		t.Fatalf("read retained canonical events: %v", err)
	}
	if len(events) != 1 || events[0].Type != "assistant.message" || events[0].Payload["text"] != "retained transcript" {
		t.Fatalf("unexpected retained canonical events: %#v", events)
	}
	providerEvents, err := session.ReadProviderEventLog(providerPath)
	if err != nil {
		t.Fatalf("read retained provider events: %v", err)
	}
	if len(providerEvents) != 1 || providerEvents[0].Runtime != "codex" || providerEvents[0].Event["type"] != "turn.completed" {
		t.Fatalf("unexpected retained provider events: %#v", providerEvents)
	}
}

func assertReadableRetryHistory(t *testing.T, eventPath string, providerPath string) {
	t.Helper()
	events, err := session.ReadEventLog(eventPath)
	if err != nil {
		t.Fatalf("read retained canonical events after cleanup retry: %v", err)
	}
	if len(events) != 1 || events[0].Payload["text"] != "retry history" {
		t.Fatalf("unexpected retained canonical retry events: %#v", events)
	}
	providerEvents, err := session.ReadProviderEventLog(providerPath)
	if err != nil {
		t.Fatalf("read retained provider events after cleanup retry: %v", err)
	}
	if len(providerEvents) != 1 || providerEvents[0].Event["type"] != "turn.completed" {
		t.Fatalf("unexpected retained provider retry events: %#v", providerEvents)
	}
}

func installRetryableScriptedGit(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	failureMarker := filepath.Join(dir, "fail-worktree-cleanup")
	writeFile(t, failureMarker, []byte("fail"))
	t.Setenv("AMA_TEST_GIT_FAILURE_MARKER", failureMarker)
	script := `#!/bin/sh
set -eu
case "$*" in
  *"worktree remove"*|*"worktree prune"*)
    if [ -f "$AMA_TEST_GIT_FAILURE_MARKER" ]; then
      exit 9
    fi
    ;;
esac
exit 0
`
	scriptPath := filepath.Join(dir, "git.sh")
	writeFile(t, scriptPath, []byte(script))
	if err := os.Chmod(scriptPath, 0o755); err != nil {
		t.Fatalf("make scripted git executable: %v", err)
	}
	executablePath := filepath.Join(dir, "git")
	if runtime.GOOS == "windows" {
		executablePath += ".cmd"
		writeFile(t, executablePath, []byte("@echo off\r\nsh \"%~dp0git.sh\" %*\r\n"))
	} else if err := os.Rename(scriptPath, executablePath); err != nil {
		t.Fatalf("install scripted git: %v", err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return failureMarker
}

func entryNames(entries []os.DirEntry) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}
