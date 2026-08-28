package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspacepath"
	"github.com/samber/lo"
)

var safeGitPathSegmentPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]+$`)

func gitRepositoryMounts(mounts []protocol.WorkspaceMount) []protocol.WorkspaceMount {
	return lo.Filter(mounts, func(mount protocol.WorkspaceMount, _ int) bool {
		return mount.Type == "git_repository"
	})
}

func memoryMounts(mounts []protocol.WorkspaceMount) []protocol.WorkspaceMount {
	return lo.Filter(mounts, func(mount protocol.WorkspaceMount, _ int) bool {
		return mount.Type == "memory"
	})
}

func secretMounts(mounts []protocol.WorkspaceMount) []protocol.WorkspaceMount {
	return lo.Filter(mounts, func(mount protocol.WorkspaceMount, _ int) bool {
		return mount.Type == "secret"
	})
}

func fileManifestEntries(files []protocol.WorkspaceFile) []protocol.WorkspaceFile {
	return lo.Map(files, func(file protocol.WorkspaceFile, _ int) protocol.WorkspaceFile {
		return protocol.WorkspaceFile{Path: file.Path}
	})
}

func materializeGitRepository(
	ctx context.Context,
	workDir string,
	sessionRoot string,
	volume protocol.WorkspaceMount,
	credentialsPath string,
) (string, string, error) {
	repositoryURL, err := parseGitRepositoryURL(volume.URL)
	if err != nil {
		return "", "", err
	}
	defaultMountPath, err := defaultGitMountPath(volume)
	if err != nil {
		return "", "", err
	}
	mountPath, err := localMountPath(sessionRoot, coalesce(volume.MountPath, defaultMountPath))
	if err != nil {
		return "", "", err
	}
	if err := os.MkdirAll(filepath.Dir(mountPath), 0o755); err != nil {
		return "", "", err
	}
	cacheDir := repositoryCacheDir(workDir, repositoryURL)
	lock := repositoryCacheLock(cacheDir)
	lock.Lock()
	defer lock.Unlock()
	if err := ensureRepositoryCache(ctx, cacheDir, volume, credentialsPath); err != nil {
		return "", "", err
	}
	if fileExists(mountPath) {
		return mountPath, cacheDir, nil
	}
	targetRef, err := resolveWorktreeRef(ctx, cacheDir, volume.Ref)
	if err != nil {
		return "", "", err
	}
	if err := git(ctx, cacheDir, "worktree", "add", "--detach", mountPath, targetRef); err != nil {
		return "", "", err
	}
	return mountPath, cacheDir, nil
}

func materializeMemoryStore(sessionRoot string, volume protocol.WorkspaceMount) (string, error) {
	defaultMountPath, err := defaultMemoryStoreMountPath(volume)
	if err != nil {
		return "", err
	}
	mountPath, err := localMountPath(sessionRoot, coalesce(volume.MountPath, defaultMountPath))
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(mountPath, 0o755); err != nil {
		return "", err
	}
	for _, memory := range volume.Files {
		relative, err := cleanMemoryPath(memory.Path)
		if err != nil {
			return "", err
		}
		fullPath := filepath.Join(mountPath, relative)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(fullPath, []byte(memory.Content), 0o644); err != nil {
			return "", err
		}
	}
	if volume.ReadOnly {
		if err := filepath.WalkDir(mountPath, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				return os.Chmod(path, 0o555)
			}
			return os.Chmod(path, 0o444)
		}); err != nil {
			return "", err
		}
	}
	return mountPath, nil
}

func materializeSecretMount(sessionRoot string, volume protocol.WorkspaceMount) (string, error) {
	mountPath, err := localMountPathForWorkspacePath(sessionRoot, volume.MountPath)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(mountPath, 0o700); err != nil {
		return "", err
	}
	for _, file := range volume.Files {
		relative, err := cleanMemoryPath(file.Path)
		if err != nil {
			return "", err
		}
		fullPath := filepath.Join(mountPath, relative)
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o700); err != nil {
			return "", err
		}
		if err := os.WriteFile(fullPath, []byte(file.Content), 0o600); err != nil {
			return "", err
		}
	}
	if !volume.ReadOnly {
		return mountPath, nil
	}
	return mountPath, filepath.WalkDir(mountPath, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return os.Chmod(path, 0o500)
		}
		return os.Chmod(path, 0o400)
	})
}

func resetMemoryStorePermissions(root string) error {
	if strings.TrimSpace(root) == "" || !fileExists(root) {
		return nil
	}
	return filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return os.Chmod(path, 0o755)
		}
		return os.Chmod(path, 0o644)
	})
}

func localMountPathForWorkspacePath(sessionRoot string, mountPath string) (string, error) {
	clean, err := workspacepath.Relative(mountPath, false)
	if err != nil {
		return "", fmt.Errorf("invalid secret volume mount path: %w", err)
	}
	resolved := filepath.Join(sessionRoot, clean)
	if err := ensureUnderWorkspace(sessionRoot, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

type MemoryStoreSnapshot struct {
	MemoryRef string                    `json:"memoryRef"`
	Memories  []protocol.MemorySnapshot `json:"memories"`
}

func readMemoryFiles(root string) ([]protocol.MemorySnapshot, error) {
	memories := []protocol.MemorySnapshot{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		clean, err := cleanMemoryPath(relative)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		memories = append(memories, protocol.MemorySnapshot{Path: filepath.ToSlash(clean), Content: string(content)})
		return nil
	})
	return memories, err
}

func cleanMemoryPath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("memory path is required")
	}
	if filepath.IsAbs(path) || strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("memory path must be relative")
	}
	clean := filepath.Clean(filepath.FromSlash(path))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("memory path must stay inside the memory store")
	}
	return clean, nil
}

func ensureRepositoryCache(ctx context.Context, cacheDir string, volume protocol.WorkspaceMount, credentialsPath string) error {
	if fileExists(filepath.Join(cacheDir, ".git")) {
		return gitWithCredentials(ctx, cacheDir, credentialsPath, "fetch", "--prune", "origin")
	}
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0o755); err != nil {
		return err
	}
	repositoryURL, err := parseGitRepositoryURL(volume.URL)
	if err != nil {
		return err
	}
	return gitWithCredentials(ctx, filepath.Dir(cacheDir), credentialsPath, "clone", repositoryURL.String(), cacheDir)
}

func resolveWorktreeRef(ctx context.Context, cacheDir string, requestedRef string) (string, error) {
	ref := strings.TrimSpace(requestedRef)
	if ref != "" {
		remoteRef := "refs/remotes/origin/" + ref
		if _, err := gitOutput(ctx, cacheDir, "rev-parse", "--verify", remoteRef); err == nil {
			return remoteRef, nil
		}
		if _, err := gitOutput(ctx, cacheDir, "rev-parse", "--verify", ref); err == nil {
			return ref, nil
		}
		return "", fmt.Errorf("repository ref %q is not available", ref)
	}
	if out, err := gitOutput(ctx, cacheDir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"); err == nil {
		return strings.TrimSpace(out), nil
	}
	return "HEAD", nil
}

func localMountPath(sessionRoot string, mountPath string) (string, error) {
	clean, err := workspacepath.Relative(mountPath, false)
	if err != nil {
		return "", fmt.Errorf("invalid mount path: %w", err)
	}
	resolved := filepath.Join(sessionRoot, clean)
	if err := ensureUnderWorkspace(sessionRoot, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func defaultGitMountPath(volume protocol.WorkspaceMount) (string, error) {
	repositoryURL, err := parseGitRepositoryURL(volume.URL)
	if err != nil {
		return "", err
	}
	path := strings.TrimSuffix(strings.Trim(repositoryURL.Path, "/"), ".git")
	return pathpkg.Join("repos", repositoryURL.Hostname(), path), nil
}

func defaultMemoryStoreMountPath(volume protocol.WorkspaceMount) (string, error) {
	storeID, err := memoryStoreIDFromRef(volume.MemoryRef)
	if err != nil {
		return "", err
	}
	return pathpkg.Join(".ama", "memory-stores", storeID), nil
}

func coalesce(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func memoryStoreIDFromRef(memoryRef string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(memoryRef))
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "ama" || parsed.Host != "memories" {
		return "", fmt.Errorf("memory volume must include memoryRef ama://memories/{storeId}")
	}
	storeID := strings.TrimPrefix(parsed.EscapedPath(), "/")
	if storeID == "" || strings.Contains(storeID, "/") {
		return "", fmt.Errorf("memory volume must include memoryRef ama://memories/{storeId}")
	}
	decoded, err := url.PathUnescape(storeID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(decoded) == "" || strings.Contains(decoded, "/") {
		return "", fmt.Errorf("memory volume must include memoryRef ama://memories/{storeId}")
	}
	return decoded, nil
}

func writeSessionState(sessionDir string, workspaceRoot string, volumes []mountedVolume) error {
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(map[string]any{
		"version":       1,
		"workspaceRoot": workspaceRoot,
		"volumes":       volumes,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(sessionDir, SessionStateFileName), data, 0o600)
}

func parseGitRepositoryURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return nil, err
	}
	if parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("git repository volume must include a safe HTTPS url")
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(segments) < 2 {
		return nil, fmt.Errorf("git repository volume must include a repository path")
	}
	for _, segment := range segments {
		decoded, err := url.PathUnescape(segment)
		if err != nil {
			return nil, fmt.Errorf("git repository volume path is unsafe")
		}
		if segment == "" || segment == "." || segment == ".." || !safeGitPathSegmentPattern.MatchString(decoded) {
			return nil, fmt.Errorf("git repository volume path is unsafe")
		}
	}
	parsed.RawQuery = ""
	return parsed, nil
}

func repositoryCacheDir(workDir string, repositoryURL *url.URL) string {
	path := strings.TrimSuffix(strings.Trim(repositoryURL.Path, "/"), ".git")
	return filepath.Join(workDir, "repositories", repositoryURL.Hostname(), filepath.FromSlash(path))
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func git(ctx context.Context, cwd string, args ...string) error {
	_, err := gitOutput(ctx, cwd, args...)
	return err
}

func gitWithCredentials(ctx context.Context, cwd string, credentialsPath string, args ...string) error {
	if credentialsPath == "" {
		return git(ctx, cwd, args...)
	}
	return git(
		ctx,
		cwd,
		append(
			[]string{
				"-c",
				"credential.helper=",
				"-c",
				fmt.Sprintf("credential.helper=store --file %q", credentialsPath),
			},
			args...,
		)...,
	)
}

func gitOutput(ctx context.Context, cwd string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}
