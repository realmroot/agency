package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

func TestResourceMountClassifiersAndFileManifestEntries(t *testing.T) {
	mounts := []protocol.WorkspaceMount{
		{Type: "git_repository", Name: "repo"},
		{Type: "memory", Name: "memory"},
		{Type: "secret", Name: "secret"},
	}
	if len(gitRepositoryMounts(mounts)) != 1 || len(memoryMounts(mounts)) != 1 || len(secretMounts(mounts)) != 1 {
		t.Fatalf("unexpected mount classification")
	}
	entries := fileManifestEntries([]protocol.WorkspaceFile{{Path: "a.txt", Content: "secret"}})
	if len(entries) != 1 || entries[0].Path != "a.txt" || entries[0].Content != "" {
		t.Fatalf("expected file manifest entries to drop content, got %#v", entries)
	}
}

func TestMaterializeSecretMountWritableAndRejectsUnsafePaths(t *testing.T) {
	root := t.TempDir()
	path, err := materializeSecretMount(root, protocol.WorkspaceMount{
		MountPath: "/workspace/secrets",
		ReadOnly:  false,
		Files:     []protocol.WorkspaceFile{{Path: "TOKEN", Content: "value"}},
	})
	if err != nil {
		t.Fatalf("materialize secret: %v", err)
	}
	if path != filepath.Join(root, "secrets") {
		t.Fatalf("unexpected secret path %q", path)
	}
	if data, err := os.ReadFile(filepath.Join(path, "TOKEN")); err != nil || string(data) != "value" {
		t.Fatalf("expected secret file, got %q err=%v", data, err)
	}
	if _, err := materializeSecretMount(root, protocol.WorkspaceMount{MountPath: "/workspace/secrets", Files: []protocol.WorkspaceFile{{Path: "../TOKEN"}}}); err == nil {
		t.Fatal("expected unsafe secret file path error")
	}
	if _, err := materializeSecretMount(root, protocol.WorkspaceMount{MountPath: ""}); err == nil {
		t.Fatal("expected missing secret mount path error")
	}
	if _, err := materializeSecretMount(root, protocol.WorkspaceMount{MountPath: "/workspace"}); err == nil {
		t.Fatal("expected workspace root secret mount path error")
	}
	if _, err := materializeSecretMount(root, protocol.WorkspaceMount{MountPath: "/workspace/../secrets"}); err == nil {
		t.Fatal("expected escaping secret mount path error")
	}
}

func TestMaterializeSecretMountReadOnly(t *testing.T) {
	root := t.TempDir()
	path, err := materializeSecretMount(root, protocol.WorkspaceMount{
		MountPath: "/workspace/secrets",
		ReadOnly:  true,
		Files:     []protocol.WorkspaceFile{{Path: "nested/TOKEN", Content: "value"}},
	})
	if err != nil {
		t.Fatalf("materialize readonly secret: %v", err)
	}
	t.Cleanup(func() {
		_ = filepath.WalkDir(path, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return os.Chmod(path, 0o755)
			}
			return os.Chmod(path, 0o644)
		})
	})
	info, err := os.Stat(filepath.Join(path, "nested", "TOKEN"))
	if err != nil {
		t.Fatalf("stat secret file: %v", err)
	}
	if info.Mode().Perm() != 0o400 {
		t.Fatalf("secret file mode = %o, want 0400", info.Mode().Perm())
	}
	dirInfo, err := os.Stat(filepath.Join(path, "nested"))
	if err != nil {
		t.Fatalf("stat secret dir: %v", err)
	}
	if dirInfo.Mode().Perm() != 0o500 {
		t.Fatalf("secret dir mode = %o, want 0500", dirInfo.Mode().Perm())
	}
}

func TestMaterializeMemoryStoreRejectsInvalidRefsAndPaths(t *testing.T) {
	root := t.TempDir()
	if _, err := materializeMemoryStore(root, protocol.WorkspaceMount{MemoryRef: "bad"}); err == nil {
		t.Fatal("expected invalid memory ref error")
	}
	if _, err := materializeMemoryStore(root, protocol.WorkspaceMount{
		MemoryRef: "ama://memories/store_1",
		Files:     []protocol.WorkspaceFile{{Path: "/absolute.md", Content: "bad"}},
	}); err == nil {
		t.Fatal("expected invalid memory path error")
	}
	if _, err := materializeMemoryStore(root, protocol.WorkspaceMount{
		MemoryRef: "ama://memories/store_1",
		MountPath: "/outside",
	}); err == nil {
		t.Fatal("expected unsafe memory mount path error")
	}
}

func TestMaterializeMemoryStoreReadOnlyAndResetPermissions(t *testing.T) {
	root := t.TempDir()
	path, err := materializeMemoryStore(root, protocol.WorkspaceMount{
		MemoryRef: "ama://memories/store_1",
		Access:    "read_only",
		Files:     []protocol.WorkspaceFile{{Path: "notes/plan.md", Content: "ship"}},
	})
	if err != nil {
		t.Fatalf("materialize memory: %v", err)
	}
	fileInfo, err := os.Stat(filepath.Join(path, "notes", "plan.md"))
	if err != nil {
		t.Fatalf("stat memory file: %v", err)
	}
	if fileInfo.Mode().Perm() != 0o444 {
		t.Fatalf("memory file mode = %o, want 0444", fileInfo.Mode().Perm())
	}
	if err := resetMemoryStorePermissions(path); err != nil {
		t.Fatalf("reset memory permissions: %v", err)
	}
	fileInfo, err = os.Stat(filepath.Join(path, "notes", "plan.md"))
	if err != nil {
		t.Fatalf("stat reset memory file: %v", err)
	}
	if fileInfo.Mode().Perm() != 0o644 {
		t.Fatalf("reset memory file mode = %o, want 0644", fileInfo.Mode().Perm())
	}
}

func TestReadMemoryFilesReadsNestedFilesAndPropagatesErrors(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes", "plan.md"), []byte("ship it"), 0o644); err != nil {
		t.Fatal(err)
	}
	memories, err := readMemoryFiles(root)
	if err != nil {
		t.Fatalf("read memory files: %v", err)
	}
	if len(memories) != 1 || memories[0].Path != "notes/plan.md" || memories[0].Content != "ship it" {
		t.Fatalf("unexpected memory snapshots %#v", memories)
	}
	if _, err := readMemoryFiles(filepath.Join(root, "missing")); err == nil {
		t.Fatal("expected missing memory root error")
	}
}

func TestResetMemoryStorePermissionsIgnoresEmptyAndMissingRoots(t *testing.T) {
	if err := resetMemoryStorePermissions(""); err != nil {
		t.Fatalf("empty root should be ignored: %v", err)
	}
	if err := resetMemoryStorePermissions(filepath.Join(t.TempDir(), "missing")); err != nil {
		t.Fatalf("missing root should be ignored: %v", err)
	}
}

func TestDefaultMountPathHelpers(t *testing.T) {
	gitPath, err := defaultGitMountPath(protocol.WorkspaceMount{URL: "https://github.com/saltbo/slink.git"})
	if err != nil || gitPath != filepath.Join("repos", "github.com", "saltbo", "slink") {
		t.Fatalf("unexpected git mount path %q err=%v", gitPath, err)
	}
	if _, err := defaultGitMountPath(protocol.WorkspaceMount{URL: "ssh://github.com/saltbo/slink.git"}); err == nil {
		t.Fatal("expected unsafe git URL error")
	}
	memoryPath, err := defaultMemoryStoreMountPath(protocol.WorkspaceMount{MemoryRef: "ama://memories/store_1"})
	if err != nil || memoryPath != filepath.Join(".ama", "memory-stores", "store_1") {
		t.Fatalf("unexpected memory mount path %q err=%v", memoryPath, err)
	}
	if coalesce(" value ", "fallback") != " value " || coalesce(" ", "fallback") != "fallback" {
		t.Fatal("unexpected coalesce behavior")
	}
	if _, err := defaultMemoryStoreMountPath(protocol.WorkspaceMount{MemoryRef: "ama://memories/"}); err == nil {
		t.Fatal("expected empty memory store id to fail")
	}
	for _, memoryRef := range []string{
		"ama://vaults/store_1",
		"ama://memories/store_1/nested",
		"ama://memories/%2F",
	} {
		if _, err := memoryStoreIDFromRef(memoryRef); err == nil {
			t.Fatalf("expected invalid memory ref %q to fail", memoryRef)
		}
	}
}

func TestMaterializeGitRepositoryRejectsInvalidInputs(t *testing.T) {
	root := t.TempDir()
	if _, _, err := materializeGitRepository(context.Background(), t.TempDir(), root, protocol.WorkspaceMount{URL: "bad-url"}, ""); err == nil {
		t.Fatal("expected invalid git repository URL error")
	}
	if _, _, err := materializeGitRepository(context.Background(), t.TempDir(), root, protocol.WorkspaceMount{
		URL:       "https://github.com/saltbo/slink.git",
		MountPath: "/outside",
	}, ""); err == nil {
		t.Fatal("expected unsafe git mount path error")
	}
}

func TestMaterializeGitRepositoryUsesCacheAndExistingMount(t *testing.T) {
	installWorkspaceFakeGit(t)
	workDir := t.TempDir()
	sessionRoot := t.TempDir()
	volume := protocol.WorkspaceMount{URL: "https://github.com/saltbo/slink.git"}
	repositoryURL, err := parseGitRepositoryURL(volume.URL)
	if err != nil {
		t.Fatal(err)
	}
	cacheDir := repositoryCacheDir(workDir, repositoryURL)
	if err := os.MkdirAll(filepath.Join(cacheDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	mountPath := filepath.Join(sessionRoot, "repos", "github.com", "saltbo", "slink")
	if err := os.MkdirAll(mountPath, 0o755); err != nil {
		t.Fatal(err)
	}
	gotMount, gotCache, err := materializeGitRepository(context.Background(), workDir, sessionRoot, volume, "")
	if err != nil {
		t.Fatalf("materialize existing git mount: %v", err)
	}
	if gotMount != mountPath || gotCache != cacheDir {
		t.Fatalf("unexpected mount/cache %q %q", gotMount, gotCache)
	}
}

func TestEnsureRepositoryCacheClonesWithFakeGit(t *testing.T) {
	installWorkspaceFakeGit(t)
	cacheDir := filepath.Join(t.TempDir(), "repositories", "github.com", "saltbo", "slink")
	err := ensureRepositoryCache(context.Background(), cacheDir, protocol.WorkspaceMount{URL: "https://github.com/saltbo/slink.git"}, "")
	if err != nil {
		t.Fatalf("expected fake clone success, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(cacheDir, ".git")); err != nil {
		t.Fatalf("expected fake clone to create git cache, got %v", err)
	}
}

func installWorkspaceFakeGit(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	gitPath := filepath.Join(dir, "git")
	script := `#!/bin/sh
set -eu
last=""
for arg in "$@"; do last="$arg"; done
case "$*" in
  clone\ *|*" clone "*)
    mkdir -p "$last/.git"
    exit 0
    ;;
  fetch\ *|*" fetch "*)
    exit 0
    ;;
  rev-parse\ *|*" rev-parse "*)
    echo HEAD
    exit 0
    ;;
  worktree\ add\ *|*" worktree add "*)
    previous=""
    for arg in "$@"; do
      if [ "$previous" = "--detach" ]; then
        mkdir -p "$arg"
        exit 0
      fi
      previous="$arg"
    done
    exit 0
    ;;
  symbolic-ref\ *|*" symbolic-ref "*)
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
`
	if err := os.WriteFile(gitPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestEnsureRepositoryCacheRejectsInvalidURL(t *testing.T) {
	err := ensureRepositoryCache(context.Background(), filepath.Join(t.TempDir(), "cache"), protocol.WorkspaceMount{URL: "bad-url"}, "")
	if err == nil {
		t.Fatal("expected invalid repository URL error")
	}
}

func TestParseGitRepositoryURLRejectsUnsafeForms(t *testing.T) {
	for _, rawURL := range []string{
		"http://github.com/saltbo/slink.git",
		"https://user@github.com/saltbo/slink.git",
		"https://github.com/saltbo/slink.git?token=secret",
		"https://github.com/saltbo/slink.git#main",
		"https://github.com/saltbo",
		"https://github.com/saltbo/../slink",
		"https://github.com/saltbo/slink space",
		"https://github.com/saltbo/%2e%2e/slink",
	} {
		if _, err := parseGitRepositoryURL(rawURL); err == nil {
			t.Fatalf("expected unsafe git URL %q to fail", rawURL)
		}
	}
}

func TestCredentialHelpersSkipInvalidInputs(t *testing.T) {
	lines := gitCredentialLines([]protocol.WorkspaceMount{
		{URL: "https://github.com/saltbo/slink.git"},
		{URL: "https://github.com/saltbo/slink.git", Credential: &protocol.WorkspaceGitCredential{Username: "", Password: "token"}},
		{URL: "bad-url", Credential: &protocol.WorkspaceGitCredential{Username: "x", Password: "token"}},
		{URL: "https://github.com/saltbo/slink.git", Credential: &protocol.WorkspaceGitCredential{Username: "x", Password: "token"}},
	})
	if len(lines) != 1 || !strings.Contains(lines[0], "https://x:token@github.com") {
		t.Fatalf("expected one valid credential line, got %#v", lines)
	}
	if path, err := writeGitCredentialStore(t.TempDir(), nil); err != nil || path != "" {
		t.Fatalf("expected no credential file for empty lines, path=%q err=%v", path, err)
	}
	parentFile := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(parentFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := writeGitCredentialStore(filepath.Join(parentFile, "session"), []string{"https://x:y@example.test\n"}); err == nil {
		t.Fatal("expected credential store write under file parent to fail")
	}
}

func TestConfigureWorkspaceGitCredentialsUsesSessionStore(t *testing.T) {
	installWorkspaceFakeGit(t)
	cacheDir := t.TempDir()
	worktreeDir := t.TempDir()
	credentialsPath := filepath.Join(t.TempDir(), "git-credentials")
	if err := os.WriteFile(credentialsPath, []byte("https://x:y@example.test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := configureWorkspaceGitCredentials(context.Background(), credentialsPath, []preparedWorktree{{
		cacheDir: cacheDir,
		path:     worktreeDir,
	}})
	if err != nil {
		t.Fatalf("expected credential helper configuration, got %v", err)
	}
	if err := configureWorkspaceGitCredentials(context.Background(), "", []preparedWorktree{{cacheDir: cacheDir, path: worktreeDir}}); err != nil {
		t.Fatalf("expected empty credentials path to skip configuration, got %v", err)
	}
}

func TestWriteSessionStateRejectsUnwritableSessionDir(t *testing.T) {
	file := filepath.Join(t.TempDir(), "state-parent-file")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeSessionState(filepath.Join(file, "session"), "/workspace", nil); err == nil {
		t.Fatal("expected state write error")
	}
}

func TestResolveWorktreeRefUsesRemoteBranchCommitOrHead(t *testing.T) {
	if _, err := execLookPathGit(); err != nil {
		t.Skipf("git not available: %v", err)
	}
	cacheDir := filepath.Join(t.TempDir(), "repo")
	runGit(t, t.TempDir(), "--version")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runGit(t, cacheDir, "init", "-b", "main")
	runGit(t, cacheDir, "config", "user.email", "runner@example.test")
	runGit(t, cacheDir, "config", "user.name", "Runner")
	if err := os.WriteFile(filepath.Join(cacheDir, "README.md"), []byte("ok\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, cacheDir, "add", "README.md")
	runGit(t, cacheDir, "commit", "-m", "init")
	commit := strings.TrimSpace(runGitOutput(t, cacheDir, "rev-parse", "HEAD"))
	runGit(t, cacheDir, "update-ref", "refs/remotes/origin/main", commit)

	if got, err := resolveWorktreeRef(context.Background(), cacheDir, "main"); err != nil || got != "refs/remotes/origin/main" {
		t.Fatalf("expected remote branch ref, got %q err=%v", got, err)
	}
	if got, err := resolveWorktreeRef(context.Background(), cacheDir, commit); err != nil || got != commit {
		t.Fatalf("expected commit ref, got %q err=%v", got, err)
	}
	if got, err := resolveWorktreeRef(context.Background(), cacheDir, "missing"); err == nil || got != "" {
		t.Fatalf("expected missing ref error, got %q err=%v", got, err)
	}
	if got, err := resolveWorktreeRef(context.Background(), cacheDir, ""); err != nil || got != "HEAD" {
		t.Fatalf("expected HEAD fallback, got %q err=%v", got, err)
	}
}

func execLookPathGit() (string, error) {
	return exec.LookPath("git")
}
