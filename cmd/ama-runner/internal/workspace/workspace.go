package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
)

// RuntimeWorkspaceRetention applies only to disposable runtime artifacts.
// Session event logs are durable history and are never removed by workspace cleanup.
const RuntimeWorkspaceRetention = 24 * time.Hour

const SessionsDirName = "sessions"
const WorkspaceDirName = "workspace"
const SessionStateFileName = "state.json"

type PrepareRequest struct {
	WorkDir   string
	SessionID string
	Manifest  protocol.WorkspaceManifest
}

type Workspace struct {
	Dir          string
	Root         string
	Cwd          string
	worktrees    []preparedWorktree
	memoryStores []preparedMemoryStore
}

type preparedWorktree struct {
	cacheDir string
	path     string
}

type preparedMemoryStore struct {
	memoryRef string
	path      string
	readOnly  bool
}

var repositoryCacheLocks sync.Map

func repositoryCacheLock(cacheDir string) *sync.Mutex {
	absolute, err := filepath.Abs(cacheDir)
	if err != nil {
		absolute = cacheDir
	}
	lock, _ := repositoryCacheLocks.LoadOrStore(absolute, &sync.Mutex{})
	return lock.(*sync.Mutex)
}

type mountedVolume struct {
	Type      string                   `json:"type"`
	URL       string                   `json:"url,omitempty"`
	Ref       string                   `json:"ref,omitempty"`
	MemoryRef string                   `json:"memoryRef,omitempty"`
	Name      string                   `json:"name,omitempty"`
	ReadOnly  bool                     `json:"readOnly,omitempty"`
	MountPath string                   `json:"mountPath,omitempty"`
	LocalPath string                   `json:"localPath,omitempty"`
	Files     []protocol.WorkspaceFile `json:"files,omitempty"`
	Status    string                   `json:"status"`
}

func Prepare(ctx context.Context, request PrepareRequest) (*Workspace, error) {
	workspace, err := Open(request.WorkDir, request.SessionID)
	if err != nil {
		return nil, err
	}
	manifest := request.Manifest
	if manifest.Root == "" {
		manifest.Root = "/workspace"
	}
	gitVolumes := gitRepositoryMounts(manifest.Mounts)
	memoryVolumeList := memoryMounts(manifest.Mounts)
	secretVolumeList := secretMounts(manifest.Mounts)
	mounted := make([]mountedVolume, 0, len(gitVolumes)+len(memoryVolumeList)+len(secretVolumeList))
	worktrees := make([]preparedWorktree, 0, len(gitVolumes))
	memoryStores := make([]preparedMemoryStore, 0, len(memoryVolumeList))
	credentialLines := gitCredentialLines(gitVolumes)
	gitCredentialsPath, err := writeGitCredentialStore(workspace.Dir, credentialLines)
	if err != nil {
		_ = workspace.Cleanup(context.Background())
		return nil, err
	}
	if gitCredentialsPath != "" {
		defer func() {
			_ = os.Remove(gitCredentialsPath)
		}()
	}
	for _, volume := range gitVolumes {
		localPath, cacheDir, err := materializeGitRepository(
			ctx,
			request.WorkDir,
			workspace.Root,
			volume,
			gitCredentialsPath,
		)
		if err != nil {
			workspace.worktrees = worktrees
			workspace.memoryStores = memoryStores
			_ = workspace.Cleanup(context.Background())
			return nil, err
		}
		mounted = append(mounted, mountedVolume{
			Type:      volume.Type,
			Name:      volume.Name,
			URL:       volume.URL,
			Ref:       volume.Ref,
			MountPath: volume.MountPath,
			LocalPath: localPath,
			Status:    "mounted",
		})
		worktrees = append(worktrees, preparedWorktree{cacheDir: cacheDir, path: localPath})
	}
	for _, volume := range memoryVolumeList {
		localPath, err := materializeMemoryStore(workspace.Root, volume)
		if err != nil {
			workspace.worktrees = worktrees
			workspace.memoryStores = memoryStores
			_ = workspace.Cleanup(context.Background())
			return nil, err
		}
		mounted = append(mounted, mountedVolume{
			Type:      volume.Type,
			MemoryRef: volume.MemoryRef,
			Name:      volume.Name,
			ReadOnly:  volume.ReadOnly,
			MountPath: volume.MountPath,
			LocalPath: localPath,
			Status:    "mounted",
		})
		memoryStores = append(memoryStores, preparedMemoryStore{memoryRef: volume.MemoryRef, path: localPath, readOnly: volume.ReadOnly})
	}
	for _, volume := range secretVolumeList {
		localPath, err := materializeSecretMount(workspace.Root, volume)
		if err != nil {
			workspace.worktrees = worktrees
			workspace.memoryStores = memoryStores
			_ = workspace.Cleanup(context.Background())
			return nil, err
		}
		mounted = append(mounted, mountedVolume{
			Type:      "secret",
			Name:      volume.Name,
			MountPath: volume.MountPath,
			LocalPath: localPath,
			Files:     fileManifestEntries(volume.Files),
			Status:    "mounted",
		})
	}
	workspace.worktrees = worktrees
	workspace.memoryStores = memoryStores
	if err := writeSessionState(workspace.Dir, workspace.Root, mounted); err != nil {
		_ = workspace.Cleanup(context.Background())
		return nil, err
	}
	return workspace, nil
}

func Open(workDir string, sessionID string) (*Workspace, error) {
	if sessionID == "" || filepath.Base(sessionID) != sessionID || sessionID == "." || sessionID == ".." {
		return nil, fmt.Errorf("session id must be a single path segment")
	}
	root, err := filepath.Abs(workDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	sessionDir := filepath.Join(resolvedRoot, SessionsDirName, sessionID)
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		return nil, err
	}
	resolvedSessionDir, err := filepath.EvalSymlinks(sessionDir)
	if err != nil {
		return nil, err
	}
	if err := ensureUnderWorkspace(resolvedRoot, resolvedSessionDir); err != nil {
		return nil, err
	}
	workspaceDir := filepath.Join(resolvedSessionDir, WorkspaceDirName)
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return nil, err
	}
	resolvedWorkspaceDir, err := filepath.EvalSymlinks(workspaceDir)
	if err != nil {
		return nil, err
	}
	if err := ensureUnderWorkspace(resolvedSessionDir, resolvedWorkspaceDir); err != nil {
		return nil, err
	}
	return &Workspace{Dir: resolvedSessionDir, Root: resolvedWorkspaceDir, Cwd: resolvedWorkspaceDir}, nil
}

func ensureUnderWorkspace(root string, resolved string) error {
	resolved, err := filepath.Abs(resolved)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("workspace paths must stay under workspace")
	}
	return nil
}

func (w *Workspace) PrepareAgent(ctx context.Context, runtimeName string, agentSnapshot map[string]any) error {
	_, err := w.PrepareAgentWithReport(ctx, runtimeName, agentSnapshot)
	return err
}

func (w *Workspace) PrepareAgentWithReport(ctx context.Context, runtimeName string, agentSnapshot map[string]any) (AgentPrepareReport, error) {
	report := AgentPrepareReport{}
	if w == nil || agentSnapshot == nil {
		return report, nil
	}
	if err := prepareRealmrootAgent(w.Root, agentSnapshot); err != nil {
		return report, err
	}
	for _, skill := range agentSkillRefs(agentSnapshot) {
		change, err := refreshAgentSkill(ctx, w.Cwd, runtimeName, skill)
		if err != nil {
			return report, err
		}
		if change != nil {
			report.SkillChanges = append(report.SkillChanges, *change)
		}
	}
	if err := materializeSubagents(w.Cwd, runtimeName, agentSubagentProfiles(agentSnapshot)); err != nil {
		return report, err
	}
	return report, nil
}

func (w *Workspace) AgentSystemPrompt(agentSnapshot map[string]any) string {
	sections := []string{}
	if value, ok := agentSnapshot["systemPrompt"].(string); ok && strings.TrimSpace(value) != "" {
		sections = append(sections, strings.TrimSpace(value))
	}
	if section := agentCapabilitiesSection(agentSnapshot); section != "" {
		sections = append(sections, section)
	}
	return strings.Join(sections, "\n\n")
}

func (w *Workspace) ReadWritableMemoryStores() ([]MemoryStoreSnapshot, error) {
	if w == nil {
		return nil, errors.New("workspace is not prepared")
	}
	stores := make([]MemoryStoreSnapshot, 0, len(w.memoryStores))
	for _, store := range w.memoryStores {
		if store.readOnly {
			continue
		}
		memories, err := readMemoryFiles(store.path)
		if err != nil {
			return nil, err
		}
		stores = append(stores, MemoryStoreSnapshot{MemoryRef: store.memoryRef, Memories: memories})
	}
	return stores, nil
}

func gitCredentialLines(volumes []protocol.WorkspaceMount) []string {
	lines := []string{}
	for _, volume := range volumes {
		if volume.Credential == nil {
			continue
		}
		username := strings.TrimSpace(volume.Credential.Username)
		password := strings.TrimSpace(volume.Credential.Password)
		if username == "" || password == "" {
			continue
		}
		repositoryURL, err := parseGitRepositoryURL(volume.URL)
		if err != nil {
			continue
		}
		lines = append(lines, gitCredentialLine(repositoryURL, volume.Credential))
	}
	return lines
}

func gitCredentialLine(repositoryURL *url.URL, credential *protocol.WorkspaceGitCredential) string {
	credentialURL := &url.URL{
		Scheme: "https",
		Host:   repositoryURL.Host,
		User:   url.UserPassword(credential.Username, credential.Password),
	}
	return credentialURL.String() + "\n"
}

func writeGitCredentialStore(sessionDir string, credentialLines []string) (string, error) {
	if len(credentialLines) == 0 {
		return "", nil
	}
	credentialsPath := filepath.Join(sessionDir, ".git-clone-credentials")
	if err := os.WriteFile(credentialsPath, []byte(strings.Join(credentialLines, "")), 0o600); err != nil {
		return "", err
	}
	return credentialsPath, nil
}

// configureWorkspaceGitCredentials gives each mounted worktree a repo-local
// credential helper backed by a session-scoped store file, so plain git commands
// authenticate with the work item's resolved git credentials instead of host
// credentials. Worktree-scoped config keeps credentials out of the shared
// repository cache and never touches the host's global config.
func configureWorkspaceGitCredentials(ctx context.Context, credentialsPath string, worktrees []preparedWorktree) error {
	if credentialsPath == "" || len(worktrees) == 0 {
		return nil
	}
	for _, worktree := range worktrees {
		lock := repositoryCacheLock(worktree.cacheDir)
		lock.Lock()
		err := configureWorktreeCredentialHelper(ctx, worktree.path, credentialsPath)
		lock.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

func configureWorktreeCredentialHelper(ctx context.Context, worktreePath string, credentialsPath string) error {
	// extensions.worktreeConfig lives in the shared cache config and only
	// unlocks per-worktree config files; the credential itself stays scoped
	// to this session's worktree.
	if err := git(ctx, worktreePath, "config", "extensions.worktreeConfig", "true"); err != nil {
		return err
	}
	// An empty first helper resets inherited helpers so the session token
	// wins over any host-level credential helpers. --replace-all collapses any
	// pre-existing values (a reused worktree config, or a host with multiple
	// credential.helper entries) to the single empty reset; a plain set fails
	// with "cannot overwrite multiple values with a single value".
	if err := git(ctx, worktreePath, "config", "--worktree", "--replace-all", "credential.helper", ""); err != nil {
		return err
	}
	helper := fmt.Sprintf("store --file %q", credentialsPath)
	return git(ctx, worktreePath, "config", "--worktree", "--add", "credential.helper", helper)
}

func (w *Workspace) Cleanup(ctx context.Context) error {
	if w == nil {
		return nil
	}
	var errs []string
	for _, memoryStore := range w.memoryStores {
		if err := resetMemoryStorePermissions(memoryStore.path); err != nil {
			errs = append(errs, err.Error())
		}
	}
	for i := len(w.worktrees) - 1; i >= 0; i-- {
		worktree := w.worktrees[i]
		if !fileExists(filepath.Join(worktree.cacheDir, ".git")) {
			continue
		}
		lock := repositoryCacheLock(worktree.cacheDir)
		lock.Lock()
		if fileExists(worktree.path) {
			if err := git(ctx, worktree.cacheDir, "worktree", "remove", "--force", worktree.path); err != nil {
				errs = append(errs, err.Error())
			}
		}
		if err := git(ctx, worktree.cacheDir, "worktree", "prune"); err != nil {
			errs = append(errs, err.Error())
		}
		lock.Unlock()
	}
	if len(errs) == 0 && w.Root != "" {
		if err := os.RemoveAll(w.Root); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("cleanup runtime workspace failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

func CleanupStale(ctx context.Context, workDir string, retention time.Duration) error {
	if retention <= 0 {
		return nil
	}
	sessionsDir := filepath.Join(workDir, SessionsDirName)
	info, err := os.Stat(sessionsDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("runtime sessions path is not a directory: %s", sessionsDir)
	}
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-retention)
	var errs []string
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if !info.ModTime().Before(cutoff) {
			continue
		}
		root := filepath.Join(sessionsDir, entry.Name())
		workspace := staleWorkspace(workDir, root)
		if err := workspace.Cleanup(ctx); err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if err := cleanupStaleSessionArtifacts(root); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("cleanup stale runtime workspaces failed: %s", strings.Join(errs, "; "))
	}
	return nil
}

func cleanupStaleSessionArtifacts(sessionDir string) error {
	info, err := os.Stat(sessionDir)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("runtime session path is not a directory: %s", sessionDir)
	}

	entries, err := os.ReadDir(sessionDir)
	if err != nil {
		return err
	}

	retainedLog := false
	var errs []string
	for _, entry := range entries {
		if isDurableSessionLog(entry) {
			retainedLog = true
			continue
		}
		if !isDisposableSessionArtifact(entry) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(sessionDir, entry.Name())); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("remove stale session artifacts failed: %s", strings.Join(errs, "; "))
	}
	if retainedLog {
		return nil
	}
	remaining, err := os.ReadDir(sessionDir)
	if err != nil {
		return err
	}
	if len(remaining) > 0 {
		return nil
	}
	if err := os.Remove(sessionDir); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func isDurableSessionLog(entry os.DirEntry) bool {
	if !entry.Type().IsRegular() {
		return false
	}
	return entry.Name() == "events.jsonl" || entry.Name() == "provider-events.jsonl"
}

func isDisposableSessionArtifact(entry os.DirEntry) bool {
	switch entry.Name() {
	case WorkspaceDirName, SessionStateFileName, ".home", ".tmp", ".git-clone-credentials":
		return true
	case "events.jsonl", "provider-events.jsonl":
		return !entry.Type().IsRegular()
	default:
		return false
	}
}

func staleWorkspace(workDir string, sessionDir string) *Workspace {
	workspaceRoot := filepath.Join(sessionDir, WorkspaceDirName)
	workspace := &Workspace{Dir: sessionDir, Root: workspaceRoot, Cwd: workspaceRoot}
	data, err := os.ReadFile(filepath.Join(sessionDir, SessionStateFileName))
	if err != nil {
		return workspace
	}
	var state struct {
		Volumes []mountedVolume `json:"volumes"`
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return workspace
	}
	addMountedVolumes(workDir, workspace, state.Volumes)
	return workspace
}

func addMountedVolumes(workDir string, workspace *Workspace, volumes []mountedVolume) {
	for _, volume := range volumes {
		if volume.LocalPath == "" {
			continue
		}
		switch volume.Type {
		case "git_repository":
			repositoryURL, err := parseGitRepositoryURL(volume.URL)
			if err != nil {
				continue
			}
			workspace.worktrees = append(workspace.worktrees, preparedWorktree{
				cacheDir: repositoryCacheDir(workDir, repositoryURL),
				path:     volume.LocalPath,
			})
		case "memory":
			workspace.memoryStores = append(workspace.memoryStores, preparedMemoryStore{
				memoryRef: volume.MemoryRef,
				path:      volume.LocalPath,
				readOnly:  volume.ReadOnly,
			})
		}
	}
}
