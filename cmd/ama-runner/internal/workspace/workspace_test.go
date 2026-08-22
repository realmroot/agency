package workspace

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

func TestWorkspaceSafety(t *testing.T) {
	workDir := t.TempDir()
	workspace, err := Open(filepath.Join(workDir, "missing-parent", "child"), "session_1")
	if err != nil {
		t.Fatalf("expected workspace creation success, got %v", err)
	}
	if !strings.HasSuffix(workspace.Root, filepath.Join("sessions", "session_1", "workspace")) {
		t.Fatalf("expected session workspace path, got %q", workspace.Root)
	}
	if _, err := Open(workDir, "../outside-session"); err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected traversal rejection, got %v", err)
	}
	fileRoot := filepath.Join(t.TempDir(), "root-file")
	if err := os.WriteFile(fileRoot, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(fileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace root file error")
	}
	for _, sessionID := range []string{"", ".", "..", "nested/session"} {
		if _, err := Open(workDir, sessionID); err == nil {
			t.Fatalf("expected invalid session id %q to fail", sessionID)
		}
	}
	sessionsFileRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(sessionsFileRoot, SessionsDirName), []byte("not a dir"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(sessionsFileRoot, "session_1"); err == nil {
		t.Fatal("expected sessions path file conflict to fail")
	}
	workspaceFileRoot := t.TempDir()
	sessionDir := filepath.Join(workspaceFileRoot, SessionsDirName, "session_1")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, WorkspaceDirName), []byte("not a dir"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(workspaceFileRoot, "session_1"); err == nil {
		t.Fatal("expected workspace path file conflict to fail")
	}
}

func TestOpenRejectsSessionSymlinkEscape(t *testing.T) {
	workDir := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(workDir, SessionsDirName)); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}
	if _, err := Open(workDir, "session_1"); err == nil || !strings.Contains(err.Error(), "stay under workspace") {
		t.Fatalf("expected symlink escape rejection, got %v", err)
	}
}

func TestPrepareWorkspaceMountsGitRepositoryWorktree(t *testing.T) {
	workDir := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "init", "-b", "main")
	runGit(t, sourceDir, "config", "user.email", "runner@example.test")
	runGit(t, sourceDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("zpan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "commit", "-m", "init")
	cacheDir := filepath.Join(workDir, "repositories", "github.com", "saltbo", "zpan")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, filepath.Dir(cacheDir), "clone", sourceDir, cacheDir)

	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Manifest:  workspaceManifest(gitRepositoryMount()),
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if !strings.HasSuffix(workspace.Dir, filepath.Join("sessions", "session_1")) {
		t.Fatalf("expected session private dir, got %q", workspace.Dir)
	}
	if !strings.HasSuffix(workspace.Root, filepath.Join("sessions", "session_1", "workspace")) {
		t.Fatalf("expected session root, got %q", workspace.Root)
	}
	if workspace.Cwd != workspace.Root {
		t.Fatalf("expected workspace root cwd, got %q", workspace.Cwd)
	}
	repoPath := filepath.Join(workspace.Root, "repos", "github.com", "saltbo", "zpan")
	if data, err := os.ReadFile(filepath.Join(repoPath, "README.md")); err != nil || strings.TrimSpace(string(data)) != "zpan" {
		t.Fatalf("expected mounted repo content, got %q err=%v", string(data), err)
	}
	gitFile, err := os.Stat(filepath.Join(repoPath, ".git"))
	if err != nil {
		t.Fatal(err)
	}
	if gitFile.IsDir() {
		t.Fatal("expected git worktree metadata file, got a full clone")
	}
	if _, err := os.Stat(filepath.Join(workspace.Root, ".ama", "resources.json")); !os.IsNotExist(err) {
		t.Fatalf("expected no legacy workspace manifest, got err=%v", err)
	}
	state, err := os.ReadFile(filepath.Join(workspace.Dir, SessionStateFileName))
	if err != nil {
		t.Fatal(err)
	}
	var savedState struct {
		Volumes []mountedVolume `json:"volumes"`
	}
	if err := json.Unmarshal(state, &savedState); err != nil {
		t.Fatal(err)
	}
	if len(savedState.Volumes) != 1 || savedState.Volumes[0].Status != "mounted" || savedState.Volumes[0].LocalPath != repoPath {
		t.Fatalf("expected mounted volume state, got %s", string(state))
	}
	if err := workspace.Cleanup(context.Background()); err != nil {
		t.Fatalf("expected workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("expected session root cleanup, got err=%v", err)
	}
	worktrees := runGitOutput(t, cacheDir, "worktree", "list", "--porcelain")
	if strings.Contains(worktrees, repoPath) {
		t.Fatalf("expected git worktree metadata cleanup, got %s", worktrees)
	}
}

func TestPrepareWorkspaceMountsMemoryStoreFiles(t *testing.T) {
	workDir := t.TempDir()
	description := "maintainer notes"
	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Manifest: workspaceManifest(memoryMount(false, description, protocol.WorkspaceFile{
			Path:    "ak-maintainer-heartbeat.md",
			Content: "initial heartbeat\n",
		})),
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	memoryPath := filepath.Join(workspace.Root, ".ama", "memory-stores", "memstore_1", "ak-maintainer-heartbeat.md")
	data, err := os.ReadFile(memoryPath)
	if err != nil || string(data) != "initial heartbeat\n" {
		t.Fatalf("expected mounted memory content, got %q err=%v", string(data), err)
	}
	if err := os.WriteFile(memoryPath, []byte("updated heartbeat\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	snapshots, err := workspace.ReadWritableMemoryStores()
	if err != nil {
		t.Fatalf("expected memory snapshot readback, got %v", err)
	}
	if len(snapshots) != 1 || snapshots[0].MemoryRef != "ama://memories/memstore_1" || len(snapshots[0].Memories) != 1 {
		t.Fatalf("expected one memory store snapshot, got %#v", snapshots)
	}
	if got := snapshots[0].Memories[0]; got.Path != "ak-maintainer-heartbeat.md" || got.Content != "updated heartbeat\n" {
		t.Fatalf("expected updated memory snapshot, got %#v", got)
	}
	if _, err := os.Stat(filepath.Join(workspace.Root, ".ama", "resources.json")); !os.IsNotExist(err) {
		t.Fatalf("expected no legacy workspace manifest, got err=%v", err)
	}
	state, err := os.ReadFile(filepath.Join(workspace.Dir, SessionStateFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(state), `"type": "memory"`) ||
		!strings.Contains(string(state), `"memoryRef": "ama://memories/memstore_1"`) ||
		!strings.Contains(string(state), `"status": "mounted"`) ||
		strings.Contains(string(state), `"description"`) ||
		strings.Contains(string(state), `"memories"`) ||
		strings.Contains(string(state), "initial heartbeat") {
		t.Fatalf("expected mounted memory state without memory metadata or content, got %s", string(state))
	}
}

func TestPrepareWorkspaceMountsSecretFiles(t *testing.T) {
	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   t.TempDir(),
		SessionID: "session_1",
		Manifest: workspaceManifest(protocol.WorkspaceMount{
			Type:      "secret",
			Name:      "vault",
			MountPath: "/workspace/.ama/secrets/vault",
			ReadOnly:  true,
			Files: []protocol.WorkspaceFile{{
				Path:    "TOKEN",
				Content: "secret-value",
			}},
		}),
	})
	if err != nil {
		t.Fatalf("expected secret mount success, got %v", err)
	}
	t.Cleanup(func() {
		_ = filepath.WalkDir(workspace.Root, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if entry.IsDir() {
				_ = os.Chmod(path, 0o700)
			} else {
				_ = os.Chmod(path, 0o600)
			}
			return nil
		})
	})
	secretPath := filepath.Join(workspace.Root, ".ama", "secrets", "vault", "TOKEN")
	data, err := os.ReadFile(secretPath)
	if err != nil || string(data) != "secret-value" {
		t.Fatalf("expected secret content, got %q err=%v", data, err)
	}
	info, err := os.Stat(secretPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o222 != 0 {
		t.Fatalf("expected read-only secret file, got %v", info.Mode().Perm())
	}
	state, err := os.ReadFile(filepath.Join(workspace.Dir, SessionStateFileName))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(state), "secret-value") || !strings.Contains(string(state), `"type": "secret"`) {
		t.Fatalf("expected secret state without content, got %s", string(state))
	}
}

func TestPrepareWorkspaceReturnsMountErrors(t *testing.T) {
	workDir := t.TempDir()
	cases := []struct {
		name     string
		manifest protocol.WorkspaceManifest
	}{
		{
			name: "memory",
			manifest: workspaceManifest(protocol.WorkspaceMount{
				Type:      "memory",
				MemoryRef: "ama://memories/store_1",
				MountPath: "/outside",
			}),
		},
		{
			name: "secret",
			manifest: workspaceManifest(protocol.WorkspaceMount{
				Type:      "secret",
				MountPath: "/workspace/.ama/secrets",
				Files:     []protocol.WorkspaceFile{{Path: "../TOKEN", Content: "bad"}},
			}),
		},
		{
			name: "git",
			manifest: workspaceManifest(protocol.WorkspaceMount{
				Type: "git_repository",
				URL:  "bad-url",
			}),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Prepare(context.Background(), PrepareRequest{
				WorkDir:   workDir,
				SessionID: "session_" + tc.name,
				Manifest:  tc.manifest,
			})
			if err == nil {
				t.Fatal("expected prepare error")
			}
		})
	}
}

func TestPrepareWorkspaceReturnsStateWriteError(t *testing.T) {
	workDir := t.TempDir()
	statePath := filepath.Join(workDir, SessionsDirName, "session_1", SessionStateFileName)
	if err := os.MkdirAll(statePath, 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Manifest:  protocol.WorkspaceManifest{},
	})
	if err == nil {
		t.Fatal("expected state write error")
	}
}

func TestWorkspaceReadsWritableMemoryStores(t *testing.T) {
	workDir := t.TempDir()
	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Manifest: workspaceManifest(memoryMount(false, "", protocol.WorkspaceFile{
			Path:    "notes/plan.md",
			Content: "initial plan\n",
		})),
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	updatedPath := filepath.Join(workspace.Root, ".ama", "memory-stores", "memstore_1", "notes", "plan.md")
	if err := os.WriteFile(updatedPath, []byte("updated plan\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	stores, err := workspace.ReadWritableMemoryStores()
	if err != nil {
		t.Fatalf("expected memory store read success, got %v", err)
	}
	if len(stores) != 1 || stores[0].MemoryRef != "ama://memories/memstore_1" || len(stores[0].Memories) != 1 {
		t.Fatalf("expected one memory store, got %#v", stores)
	}
	if got := stores[0].Memories[0]; got.Path != "notes/plan.md" || got.Content != "updated plan\n" {
		t.Fatalf("expected updated memory content, got %#v", got)
	}
}

func TestWorkspaceReadWritableMemoryStoresNilAndReadOnly(t *testing.T) {
	if _, err := (*Workspace)(nil).ReadWritableMemoryStores(); err == nil || !strings.Contains(err.Error(), "workspace is not prepared") {
		t.Fatalf("expected nil workspace error, got %v", err)
	}
	if _, err := (&Workspace{memoryStores: []preparedMemoryStore{{
		memoryRef: "ama://memories/missing",
		path:      filepath.Join(t.TempDir(), "missing"),
		readOnly:  false,
	}}}).ReadWritableMemoryStores(); err == nil {
		t.Fatal("expected missing writable memory store error")
	}
	prepared, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   t.TempDir(),
		SessionID: "session_1",
		Manifest: workspaceManifest(memoryMount(true, "", protocol.WorkspaceFile{
			Path:    "notes.md",
			Content: "readonly",
		})),
	})
	if err != nil {
		t.Fatalf("prepare read-only memory: %v", err)
	}
	t.Cleanup(func() {
		_ = prepared.Cleanup(context.Background())
	})
	stores, err := prepared.ReadWritableMemoryStores()
	if err != nil {
		t.Fatalf("read writable stores: %v", err)
	}
	if len(stores) != 0 {
		t.Fatalf("expected read-only memory store to be skipped, got %#v", stores)
	}
}

func TestWorkspaceCleanupNilAndSkipMissingGitCache(t *testing.T) {
	if err := (*Workspace)(nil).Cleanup(context.Background()); err != nil {
		t.Fatalf("nil cleanup should succeed: %v", err)
	}
	root := t.TempDir()
	workspace := &Workspace{
		Root: root,
		worktrees: []preparedWorktree{{
			cacheDir: filepath.Join(t.TempDir(), "missing-cache"),
			path:     filepath.Join(root, "repo"),
		}},
	}
	if err := workspace.Cleanup(context.Background()); err != nil {
		t.Fatalf("cleanup should ignore missing git cache: %v", err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("expected root removal, got %v", err)
	}
}

func TestWorkspaceCleanupAggregatesGitErrors(t *testing.T) {
	installWorkspaceScriptedGit(t, `#!/bin/sh
set -eu
case "$*" in
  *"worktree remove"*|*"worktree prune"*) exit 9 ;;
  *) exit 0 ;;
esac
`)
	root := t.TempDir()
	cacheDir := t.TempDir()
	worktreePath := filepath.Join(root, "repo")
	if err := os.MkdirAll(filepath.Join(cacheDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(worktreePath, 0o755); err != nil {
		t.Fatal(err)
	}
	err := (&Workspace{
		Root: root,
		worktrees: []preparedWorktree{{
			cacheDir: cacheDir,
			path:     worktreePath,
		}},
	}).Cleanup(context.Background())
	if err == nil || !strings.Contains(err.Error(), "cleanup runtime workspace failed") {
		t.Fatalf("expected aggregated cleanup error, got %v", err)
	}
}

func TestEnsureUnderWorkspaceRejectsOutsidePaths(t *testing.T) {
	root := t.TempDir()
	if err := ensureUnderWorkspace(root, filepath.Dir(root)); err == nil {
		t.Fatal("expected outside path error")
	}
}

func TestWorkspacePrepareUsesDefaultRootAndRecoversMountedState(t *testing.T) {
	workDir := t.TempDir()
	prepared, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Manifest: protocol.WorkspaceManifest{Mounts: []protocol.WorkspaceMount{
			memoryMount(false, "", protocol.WorkspaceFile{Path: "notes.md", Content: "hello"}),
		}},
	})
	if err != nil {
		t.Fatalf("prepare workspace: %v", err)
	}
	if prepared.Root == "" || !strings.HasSuffix(prepared.Root, filepath.Join("session_1", "workspace")) {
		t.Fatalf("unexpected prepared root %q", prepared.Root)
	}
	recovered := staleWorkspace(workDir, prepared.Dir)
	if len(recovered.memoryStores) != 1 || recovered.memoryStores[0].memoryRef != "ama://memories/memstore_1" {
		t.Fatalf("expected stale workspace to restore memory store, got %#v", recovered.memoryStores)
	}
}

func TestStaleWorkspaceIgnoresMissingOrInvalidState(t *testing.T) {
	workDir := t.TempDir()
	sessionDir := filepath.Join(workDir, SessionsDirName, "session_1")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := staleWorkspace(workDir, sessionDir); len(got.memoryStores) != 0 || len(got.worktrees) != 0 {
		t.Fatalf("expected no restored mounts without state, got %#v", got)
	}
	if err := os.WriteFile(filepath.Join(sessionDir, SessionStateFileName), []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := staleWorkspace(workDir, sessionDir); len(got.memoryStores) != 0 || len(got.worktrees) != 0 {
		t.Fatalf("expected invalid state to be ignored, got %#v", got)
	}
}

func TestAddMountedVolumesSkipsInvalidEntries(t *testing.T) {
	workDir := t.TempDir()
	workspace := &Workspace{}
	addMountedVolumes(workDir, workspace, []mountedVolume{
		{Type: "git_repository", URL: "https://github.com/saltbo/slink.git", LocalPath: "/tmp/repo"},
		{Type: "memory", MemoryRef: "ama://memories/store_1", ReadOnly: false},
		{Type: "git_repository", URL: "bad-url", LocalPath: "/tmp/repo"},
		{Type: "memory", MemoryRef: "ama://memories/store_2", ReadOnly: true, LocalPath: "/tmp/memory"},
	})
	if len(workspace.memoryStores) != 1 || workspace.memoryStores[0].memoryRef != "ama://memories/store_2" {
		t.Fatalf("expected only valid local path memory mount, got %#v", workspace.memoryStores)
	}
	if len(workspace.worktrees) != 1 || workspace.worktrees[0].path != "/tmp/repo" {
		t.Fatalf("expected valid git mount restored, got %#v", workspace.worktrees)
	}
}

func TestWorkspaceAgentSystemPromptIncludesCapabilities(t *testing.T) {
	prompt := (&Workspace{}).AgentSystemPrompt(map[string]any{
		"systemPrompt":    "Be precise.",
		"skills":          []any{"review", "triage"},
		"subagents":       []any{map[string]any{"name": "reviewer", "description": "Reviews pull requests"}},
		"ignoredProperty": "ignored",
	})
	for _, want := range []string{
		"Be precise.",
		"Skills: review, triage",
		"Available subagents: @reviewer (Reviews pull requests)",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("expected prompt to contain %q, got %s", want, prompt)
		}
	}
}

func TestPrepareAgentWithReportSkipsNilInputs(t *testing.T) {
	if report, err := (*Workspace)(nil).PrepareAgentWithReport(context.Background(), "codex", map[string]any{}); err != nil || len(report.SkillChanges) != 0 {
		t.Fatalf("expected nil workspace no-op, report=%#v err=%v", report, err)
	}
	if report, err := (&Workspace{}).PrepareAgentWithReport(context.Background(), "codex", nil); err != nil || len(report.SkillChanges) != 0 {
		t.Fatalf("expected nil agent snapshot no-op, report=%#v err=%v", report, err)
	}
}

func TestPrepareWorkspaceRejectsUnsafeMemoryPath(t *testing.T) {
	_, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   t.TempDir(),
		SessionID: "session_1",
		Manifest: workspaceManifest(memoryMount(false, "", protocol.WorkspaceFile{
			Path:    "../outside.md",
			Content: "bad",
		})),
	})
	if err == nil || !strings.Contains(err.Error(), "memory path must stay inside") {
		t.Fatalf("expected unsafe memory path error, got %v", err)
	}
}

func TestWorkspacePathValidationHelpers(t *testing.T) {
	root := t.TempDir()
	if _, err := localMountPath(root, "/workspace/repo"); err != nil {
		t.Fatalf("expected workspace path, got %v", err)
	}
	for _, path := range []string{"", "/workspace", "/etc/passwd", "../escape"} {
		if _, err := localMountPath(root, path); err == nil {
			t.Fatalf("expected unsafe mount path error for %q", path)
		}
	}
	if _, err := localMountPathForWorkspacePath(root, "/workspace/secrets"); err != nil {
		t.Fatalf("expected secret path, got %v", err)
	}
	for _, path := range []string{"", "/workspace", "/etc/passwd", "../escape"} {
		if _, err := localMountPathForWorkspacePath(root, path); err == nil {
			t.Fatalf("expected unsafe secret path error for %q", path)
		}
	}
	for _, path := range []string{"", "/abs", "../escape"} {
		if _, err := cleanMemoryPath(path); err == nil {
			t.Fatalf("expected unsafe memory path error for %q", path)
		}
	}
}

func TestWorkspaceReferenceParsing(t *testing.T) {
	if id, err := memoryStoreIDFromRef("ama://memories/store%201"); err != nil || id != "store 1" {
		t.Fatalf("expected decoded memory id, id=%q err=%v", id, err)
	}
	for _, ref := range []string{"", "https://example.test/store", "ama://memories", "ama://memories/a/b", "ama://memories/%zz"} {
		if _, err := memoryStoreIDFromRef(ref); err == nil {
			t.Fatalf("expected invalid memory ref error for %q", ref)
		}
	}
	if parsed, err := parseGitRepositoryURL("https://github.com/saltbo/zpan.git"); err != nil || parsed.Hostname() != "github.com" {
		t.Fatalf("expected git url, parsed=%v err=%v", parsed, err)
	}
	for _, raw := range []string{
		"http://github.com/saltbo/zpan.git",
		"https://user@github.com/saltbo/zpan.git",
		"https://github.com/saltbo",
		"https://github.com/saltbo/../zpan.git",
		"https://github.com/saltbo/zpan.git?token=secret",
		"https://github.com/saltbo/%zz/zpan.git",
	} {
		if _, err := parseGitRepositoryURL(raw); err == nil {
			t.Fatalf("expected unsafe git url error for %q", raw)
		}
	}
}

func TestCleanupWorkspaceRemovesReadOnlyMemoryStore(t *testing.T) {
	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   t.TempDir(),
		SessionID: "session_1",
		Manifest: workspaceManifest(memoryMount(true, "", protocol.WorkspaceFile{
			Path:    "ak-maintainer-heartbeat.md",
			Content: "initial heartbeat\n",
		})),
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if err := workspace.Cleanup(context.Background()); err != nil {
		t.Fatalf("expected read-only memory workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("expected session root cleanup, got err=%v", err)
	}
}

func TestCleanupStaleHandlesRetentionMissingAndRecentWorkspaces(t *testing.T) {
	if err := CleanupStale(context.Background(), t.TempDir(), 0); err != nil {
		t.Fatalf("non-positive retention should be no-op: %v", err)
	}
	if err := CleanupStale(context.Background(), filepath.Join(t.TempDir(), "missing"), time.Hour); err != nil {
		t.Fatalf("missing work dir should be no-op: %v", err)
	}
	workDir := t.TempDir()
	recent, err := Open(workDir, "recent")
	if err != nil {
		t.Fatal(err)
	}
	if err := CleanupStale(context.Background(), workDir, time.Hour); err != nil {
		t.Fatalf("cleanup stale: %v", err)
	}
	if _, err := os.Stat(recent.Root); err != nil {
		t.Fatalf("recent workspace should remain, got %v", err)
	}
}

func TestCleanupStaleReturnsReadDirError(t *testing.T) {
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, SessionsDirName), []byte("not a dir"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := CleanupStale(context.Background(), workDir, time.Hour); err == nil {
		t.Fatal("expected cleanup stale read dir error")
	}
}

func TestCleanupStaleSessionArtifactsHandlesMissingAndInvalidRoots(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing-session")
	if err := cleanupStaleSessionArtifacts(missing); err != nil {
		t.Fatalf("missing session root should be an idempotent no-op: %v", err)
	}

	rootFile := filepath.Join(t.TempDir(), "session-file")
	if err := os.WriteFile(rootFile, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := cleanupStaleSessionArtifacts(rootFile); err == nil {
		t.Fatal("expected session artifact cleanup to reject a non-directory root")
	}
}

func TestCleanupStaleSkipsNonDirectoryEntries(t *testing.T) {
	workDir := t.TempDir()
	sessionsDir := filepath.Join(workDir, SessionsDirName)
	if err := os.MkdirAll(sessionsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(sessionsDir, "not-a-session")
	if err := os.WriteFile(file, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(file, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := CleanupStale(context.Background(), workDir, time.Hour); err != nil {
		t.Fatalf("cleanup stale with file entry: %v", err)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "keep" {
		t.Fatalf("expected non-directory entry to remain, data=%q err=%v", data, err)
	}
}

func TestCleanupStaleRemovesOldWorkspaceWithInvalidState(t *testing.T) {
	workDir := t.TempDir()
	oldSession := filepath.Join(workDir, SessionsDirName, "old")
	if err := os.MkdirAll(filepath.Join(oldSession, WorkspaceDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldSession, SessionStateFileName), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(oldSession, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := CleanupStale(context.Background(), workDir, time.Hour); err != nil {
		t.Fatalf("cleanup stale invalid state: %v", err)
	}
	if _, err := os.Stat(oldSession); !os.IsNotExist(err) {
		t.Fatalf("expected old session removed, got %v", err)
	}
}

func TestPrepareWorkspaceUsesCloneCredentialWithoutPersistingGitAuth(t *testing.T) {
	workDir := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "init", "-b", "main")
	runGit(t, sourceDir, "config", "user.email", "runner@example.test")
	runGit(t, sourceDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("zpan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "commit", "-m", "init")
	cacheDir := filepath.Join(workDir, "repositories", "github.com", "saltbo", "zpan")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, filepath.Dir(cacheDir), "clone", sourceDir, cacheDir)
	volume := gitRepositoryMount()
	volume.Credential = &protocol.WorkspaceGitCredential{
		Username: "x-access-token",
		Password: "ghs_session_token",
	}

	workspace, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_1",
		Manifest:  workspaceManifest(volume),
	})
	if err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspace.Dir, ".git-clone-credentials")); !os.IsNotExist(err) {
		t.Fatalf("expected clone credential store to be removed after prepare, got err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(workspace.Dir, ".home", ".git-credentials")); !os.IsNotExist(err) {
		t.Fatalf("expected no worker git credential store before ak auth git, got err=%v", err)
	}
	repoPath := filepath.Join(workspace.Root, "repos", "github.com", "saltbo", "zpan")
	helperCheck := exec.Command("git", "config", "--worktree", "--get-all", "credential.helper")
	helperCheck.Dir = repoPath
	if output, err := helperCheck.CombinedOutput(); err == nil && strings.TrimSpace(string(output)) != "" {
		t.Fatalf("expected no bootstrap credential helper after clone, got %q", string(output))
	}

	// A token must stay scoped to its session: a second workspace from the
	// same repository cache prepared without a manifest credential sees no helper.
	second, err := Prepare(context.Background(), PrepareRequest{
		WorkDir:   workDir,
		SessionID: "session_2",
		Manifest:  workspaceManifest(gitRepositoryMount()),
	})
	if err != nil {
		t.Fatalf("expected second workspace preparation success, got %v", err)
	}
	leakCheck := exec.Command("git", "config", "--worktree", "--get-all", "credential.helper")
	leakCheck.Dir = filepath.Join(second.Root, "repos", "github.com", "saltbo", "zpan")
	if output, err := leakCheck.CombinedOutput(); err == nil && strings.TrimSpace(string(output)) != "" {
		t.Fatalf("expected no credential helper leak into other sessions, got %q", string(output))
	}
	if _, err := os.Stat(filepath.Join(second.Dir, ".git-clone-credentials")); !os.IsNotExist(err) {
		t.Fatalf("expected no credential store without a manifest credential, got err=%v", err)
	}
	for _, prepared := range []*Workspace{workspace, second} {
		if err := prepared.Cleanup(context.Background()); err != nil {
			t.Fatalf("expected workspace cleanup success, got %v", err)
		}
	}
}

func TestPrepareWorkspaceSerializesSharedRepositoryCache(t *testing.T) {
	workDir := t.TempDir()
	sourceDir := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "init", "-b", "main")
	runGit(t, sourceDir, "config", "user.email", "runner@example.test")
	runGit(t, sourceDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("zpan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "commit", "-m", "init")
	cacheDir := filepath.Join(workDir, "repositories", "github.com", "saltbo", "zpan")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, filepath.Dir(cacheDir), "clone", sourceDir, cacheDir)

	volume := gitRepositoryMount()
	workspaces := make(chan *Workspace, 2)
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, sessionID := range []string{"session_1", "session_2"} {
		wg.Add(1)
		go func(sessionID string) {
			defer wg.Done()
			workspace, err := Prepare(context.Background(), PrepareRequest{
				WorkDir:   workDir,
				SessionID: sessionID,
				Manifest:  workspaceManifest(volume),
			})
			if err != nil {
				errs <- err
				return
			}
			workspaces <- workspace
		}(sessionID)
	}
	wg.Wait()
	close(errs)
	close(workspaces)
	for err := range errs {
		t.Fatalf("expected concurrent workspace preparation success, got %v", err)
	}
	for workspace := range workspaces {
		repoPath := filepath.Join(workspace.Root, "repos", "github.com", "saltbo", "zpan")
		if data, err := os.ReadFile(filepath.Join(repoPath, "README.md")); err != nil || strings.TrimSpace(string(data)) != "zpan" {
			t.Fatalf("expected mounted repo content, got %q err=%v", string(data), err)
		}
		if err := workspace.Cleanup(context.Background()); err != nil {
			t.Fatalf("expected concurrent workspace cleanup success, got %v", err)
		}
	}
}

func TestCleanupStaleWorkspacesRemovesExpiredSessionRoots(t *testing.T) {
	workDir := t.TempDir()
	sessionRoot := filepath.Join(workDir, "sessions", "session_old")
	if err := os.MkdirAll(filepath.Join(sessionRoot, WorkspaceDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(sessionRoot, old, old); err != nil {
		t.Fatal(err)
	}
	if err := CleanupStale(context.Background(), workDir, time.Hour); err != nil {
		t.Fatalf("expected stale workspace cleanup success, got %v", err)
	}
	if _, err := os.Stat(sessionRoot); !os.IsNotExist(err) {
		t.Fatalf("expected stale session root cleanup, got err=%v", err)
	}
}

func TestStaleWorkspaceRestoresMountedVolumesFromState(t *testing.T) {
	workDir := t.TempDir()
	sessionRoot := filepath.Join(workDir, SessionsDirName, "session_old")
	workspaceRoot := filepath.Join(sessionRoot, WorkspaceDirName)
	if err := os.MkdirAll(workspaceRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	state := `{
		"volumes": [
			{"type":"git_repository","url":"https://github.com/saltbo/zpan.git","localPath":"` + filepath.ToSlash(filepath.Join(workspaceRoot, "repo")) + `"},
			{"type":"memory","memoryRef":"ama://memories/store_1","readOnly":false,"localPath":"` + filepath.ToSlash(filepath.Join(workspaceRoot, "memory")) + `"},
			{"type":"git_repository","url":"not-url","localPath":"ignored"},
			{"type":"memory","memoryRef":"missing-path"}
		]
	}`
	if err := os.WriteFile(filepath.Join(sessionRoot, SessionStateFileName), []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	workspace := staleWorkspace(workDir, sessionRoot)
	if len(workspace.worktrees) != 1 || len(workspace.memoryStores) != 1 {
		t.Fatalf("expected mounted volumes to be restored, got worktrees=%#v memory=%#v", workspace.worktrees, workspace.memoryStores)
	}
	if !strings.Contains(workspace.worktrees[0].cacheDir, filepath.Join("repositories", "github.com", "saltbo", "zpan")) {
		t.Fatalf("unexpected restored cache dir: %#v", workspace.worktrees[0])
	}
}

func workspaceManifest(mounts ...protocol.WorkspaceMount) protocol.WorkspaceManifest {
	return protocol.WorkspaceManifest{Root: "/workspace", Mounts: mounts}
}

func gitRepositoryMount() protocol.WorkspaceMount {
	return protocol.WorkspaceMount{
		Type:      "git_repository",
		Name:      "source",
		MountPath: "/workspace/repos/github.com/saltbo/zpan",
		URL:       "https://github.com/saltbo/zpan.git",
		Ref:       "main",
	}
}

func memoryMount(readOnly bool, description string, files ...protocol.WorkspaceFile) protocol.WorkspaceMount {
	mount := protocol.WorkspaceMount{
		Type:      "memory",
		Name:      "maintainer-memory",
		MountPath: "/workspace/.ama/memory-stores/memstore_1",
		MemoryRef: "ama://memories/memstore_1",
		ReadOnly:  readOnly,
		Files:     files,
	}
	if description != "" {
		mount.Description = &description
	}
	return mount
}

func runGit(t *testing.T, cwd string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v: %s", strings.Join(args, " "), err, string(output))
	}
}

func runGitOutput(t *testing.T, cwd string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v: %s", strings.Join(args, " "), err, string(output))
	}
	return string(output)
}
