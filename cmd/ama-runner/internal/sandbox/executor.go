package sandbox

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
)

type ToolRequest struct {
	ToolCallID string
	ToolName   string
	Input      map[string]any
	WorkDir    string
	Env        map[string]string
}

type ToolResult struct {
	Output map[string]any
}

type SandboxAdapter interface {
	Execute(ctx context.Context, request ToolRequest) (ToolResult, error)
}

type ProcessAdapter struct {
	CommandTimeout        time.Duration
	ShutdownGraceInterval time.Duration
}

func (a ProcessAdapter) Execute(ctx context.Context, request ToolRequest) (ToolResult, error) {
	switch request.ToolName {
	case "bash":
		return a.exec(ctx, request)
	case "read":
		return a.read(request)
	case "write":
		return a.write(request)
	case "edit":
		return a.edit(request)
	case "grep":
		return a.command(ctx, request, grepCommand(request.Input), 0)
	case "find":
		return a.command(ctx, request, findCommand(request.Input), 0)
	case "ls":
		return a.command(ctx, request, lsCommand(request.Input), 0)
	case "fetch":
		return a.command(ctx, request, fetchCommand(request.Input), 90*time.Second)
	case "web_search":
		return a.command(ctx, request, webSearchCommand(request.Input), 90*time.Second)
	default:
		return ToolResult{}, fmt.Errorf("unsupported sandbox tool: %s", request.ToolName)
	}
}

func (a ProcessAdapter) exec(ctx context.Context, request ToolRequest) (ToolResult, error) {
	command, ok := StringInput(request.Input, "command")
	if !ok || strings.TrimSpace(command) == "" {
		return ToolResult{}, fmt.Errorf("bash requires a non-empty command")
	}
	return a.command(ctx, request, command, 0)
}

func (a ProcessAdapter) command(ctx context.Context, request ToolRequest, command string, timeout time.Duration) (ToolResult, error) {
	if strings.TrimSpace(command) == "" {
		return ToolResult{}, fmt.Errorf("%s produced an empty command", request.ToolName)
	}
	commandTimeout := a.CommandTimeout
	if commandTimeout <= 0 {
		commandTimeout = 10 * time.Minute
	}
	if timeout > 0 && timeout < commandTimeout {
		commandTimeout = timeout
	}
	commandCtx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	env, err := ProcessCommandEnvironment(request.WorkDir)
	if err != nil {
		return ToolResult{}, err
	}
	env, err = appendRequestEnvironment(env, request.Env)
	if err != nil {
		return ToolResult{}, err
	}
	cmd := exec.CommandContext(commandCtx, "sh", "-lc", command)
	cmd.Dir = request.WorkDir
	cmd.Env = env
	if runtime.GOOS != "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return ToolResult{}, err
	}
	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()
	var waitErr error
	select {
	case waitErr = <-done:
	case <-commandCtx.Done():
		a.stopProcess(cmd)
		waitErr = <-done
	}
	exitCode := 0
	if waitErr != nil {
		exitCode = 1
		var exitError *exec.ExitError
		if AsExitError(waitErr, &exitError) {
			exitCode = exitError.ExitCode()
		}
	}
	output := map[string]any{
		"stdout":   stdout.String(),
		"stderr":   stderr.String(),
		"exitCode": exitCode,
	}
	if commandCtx.Err() != nil {
		return ToolResult{Output: output}, commandCtx.Err()
	}
	if waitErr != nil {
		return ToolResult{Output: output}, fmt.Errorf("command exited with code %d", exitCode)
	}
	return ToolResult{Output: output}, nil
}

func (a ProcessAdapter) read(request ToolRequest) (ToolResult, error) {
	path, ok := StringInput(request.Input, "path")
	if !ok || strings.TrimSpace(path) == "" {
		return ToolResult{}, fmt.Errorf("read requires a path")
	}
	resolved, err := ResolveReadPath(request.WorkDir, path)
	if err != nil {
		return ToolResult{}, err
	}
	content, err := os.ReadFile(resolved)
	if err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Output: map[string]any{"content": string(content), "path": path}}, nil
}

func (a ProcessAdapter) write(request ToolRequest) (ToolResult, error) {
	path, ok := StringInput(request.Input, "path")
	if !ok || strings.TrimSpace(path) == "" {
		return ToolResult{}, fmt.Errorf("write requires a path")
	}
	content, ok := StringInput(request.Input, "content")
	if !ok {
		return ToolResult{}, fmt.Errorf("write requires string content")
	}
	resolved, err := ResolveWritePath(request.WorkDir, path)
	if err != nil {
		return ToolResult{}, err
	}
	if err := os.WriteFile(resolved, []byte(content), 0o644); err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Output: map[string]any{"ok": true, "path": path, "bytes": len(content)}}, nil
}

func (a ProcessAdapter) edit(request ToolRequest) (ToolResult, error) {
	path, ok := StringInput(request.Input, "path")
	if !ok || strings.TrimSpace(path) == "" {
		return ToolResult{}, fmt.Errorf("edit requires a path")
	}
	edits, ok := request.Input["edits"].([]any)
	if !ok || len(edits) == 0 {
		return ToolResult{}, fmt.Errorf("edit requires at least one edit")
	}
	resolved, err := ResolveWritePath(request.WorkDir, path)
	if err != nil {
		return ToolResult{}, err
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return ToolResult{}, err
	}
	content := string(data)
	for _, value := range edits {
		edit, ok := value.(map[string]any)
		if !ok {
			return ToolResult{}, fmt.Errorf("edit entries must be objects")
		}
		oldText, ok := StringInput(edit, "oldText")
		if !ok || oldText == "" {
			return ToolResult{}, fmt.Errorf("edit oldText must be a non-empty string")
		}
		newText, ok := StringInput(edit, "newText")
		if !ok {
			return ToolResult{}, fmt.Errorf("edit newText must be a string")
		}
		if !strings.Contains(content, oldText) {
			return ToolResult{}, fmt.Errorf("edit oldText was not found")
		}
		content = strings.Replace(content, oldText, newText, 1)
	}
	if err := os.WriteFile(resolved, []byte(content), 0o644); err != nil {
		return ToolResult{}, err
	}
	return ToolResult{Output: map[string]any{"ok": true, "path": path}}, nil
}

func (a ProcessAdapter) stopProcess(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if runtime.GOOS != "windows" {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		time.Sleep(a.ShutdownGraceInterval)
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		return
	}
	_ = cmd.Process.Kill()
}

func StringInput(input map[string]any, key string) (string, bool) {
	value, ok := input[key].(string)
	return value, ok
}

func OptionalStringInput(input map[string]any, key string, fallback string) string {
	value, ok := StringInput(input, key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func PositiveIntInput(input map[string]any, key string, fallback int) int {
	value, ok := input[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		if typed >= 0 {
			return typed
		}
	case float64:
		if typed >= 0 && typed == float64(int(typed)) {
			return int(typed)
		}
	}
	return fallback
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func shellPath(input map[string]any) string {
	return shellQuote(OptionalStringInput(input, "path", "."))
}

func grepCommand(input map[string]any) string {
	pattern, _ := StringInput(input, "pattern")
	args := []string{"rg", "--line-number", "--color", "never"}
	if value, ok := input["ignoreCase"].(bool); ok && value {
		args = append(args, "--ignore-case")
	}
	if value, ok := input["literal"].(bool); ok && value {
		args = append(args, "--fixed-strings")
	}
	if glob, ok := StringInput(input, "glob"); ok && strings.TrimSpace(glob) != "" {
		args = append(args, "--glob", shellQuote(glob))
	}
	if _, ok := input["context"]; ok {
		args = append(args, "--context", strconv.Itoa(PositiveIntInput(input, "context", 0)))
	}
	args = append(args, "--max-count", strconv.Itoa(PositiveIntInput(input, "limit", 200)))
	args = append(args, shellQuote(pattern), shellPath(input))
	return strings.Join(args, " ")
}

func findCommand(input map[string]any) string {
	limit := PositiveIntInput(input, "limit", 200)
	if glob, ok := StringInput(input, "glob"); ok && strings.TrimSpace(glob) != "" {
		return "rg --files --glob " + shellQuote(glob) + " " + shellPath(input) + " | head -n " + strconv.Itoa(limit)
	}
	pattern, ok := StringInput(input, "pattern")
	if !ok || strings.TrimSpace(pattern) == "" {
		return ""
	}
	return "find " + shellPath(input) + " -type f -name " + shellQuote("*"+pattern+"*") + " -print | head -n " + strconv.Itoa(limit)
}

func lsCommand(input map[string]any) string {
	limit := PositiveIntInput(input, "limit", 200)
	return "find " + shellPath(input) + " -maxdepth 1 -mindepth 1 -print | sort | head -n " + strconv.Itoa(limit)
}

func fetchCommand(input map[string]any) string {
	url, _ := StringInput(input, "url")
	return "curl -fsS --max-time 60 " + shellQuote(url)
}

func webSearchCommand(input map[string]any) string {
	query, _ := StringInput(input, "query")
	limit := PositiveIntInput(input, "limit", 20)
	if limit > 50 {
		limit = 50
	}
	url := "https://lite.duckduckgo.com/lite/?q=" + strings.ReplaceAll(query, " ", "+")
	return strings.Join([]string{
		"curl -fsSL --max-time 30 " + shellQuote(url),
		"sed -E 's/<[^>]*>/ /g; s/&amp;/\\&/g; s/&quot;/\"/g'",
		"awk '{$1=$1; if (length($0) > 0) print}'",
		"head -n " + strconv.Itoa(limit*4),
	}, " | ")
}

func appendRequestEnvironment(env []string, requestEnv map[string]string) ([]string, error) {
	for key, value := range requestEnv {
		if key == "" || strings.Contains(key, "=") {
			return nil, fmt.Errorf("env key %q is invalid", key)
		}
		if strings.HasPrefix(key, "AMA_") {
			return nil, fmt.Errorf("env key %q is reserved", key)
		}
		env = append(env, key+"="+value)
	}
	return env, nil
}

func ProcessCommandEnvironment(workDir string) ([]string, error) {
	root, err := filepath.Abs(workDir)
	if err != nil {
		return nil, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	envRoot := ProcessEnvironmentRoot(root)
	homeDir, err := PrepareProcessEnvironmentDir(envRoot, ".home")
	if err != nil {
		return nil, err
	}
	tempDir, err := PrepareProcessEnvironmentDir(envRoot, ".tmp")
	if err != nil {
		return nil, err
	}

	env := []string{
		"HOME=" + homeDir,
		"AMA_WORKSPACE_HOME=" + homeDir,
		"GH_CONFIG_DIR=" + filepath.Join(homeDir, ".config", "gh"),
		"GIT_CONFIG_GLOBAL=" + filepath.Join(homeDir, ".gitconfig"),
		"GIT_CONFIG_NOSYSTEM=1",
		"TMPDIR=" + tempDir,
		"TEMP=" + tempDir,
		"TMP=" + tempDir,
	}
	for _, key := range []string{"PATH", "SystemRoot", "ComSpec"} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env, nil
}

func ProcessEnvironmentRoot(workDir string) string {
	if filepath.Base(workDir) != workspace.WorkspaceDirName {
		return workDir
	}
	sessionDir := filepath.Dir(workDir)
	if filepath.Base(filepath.Dir(sessionDir)) != workspace.SessionsDirName {
		return workDir
	}
	return sessionDir
}

func PrepareProcessEnvironmentDir(root string, name string) (string, error) {
	dir := filepath.Join(root, name)
	info, err := os.Lstat(dir)
	if os.IsNotExist(err) {
		if err := os.Mkdir(dir, 0o700); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("process environment directories must not be symlinks")
		}
		if !info.IsDir() {
			return "", fmt.Errorf("process environment path must be a directory")
		}
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", err
	}
	if err := EnsureUnderWorkspace(root, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func ResolveReadPath(workDir string, path string) (string, error) {
	root, relative, err := WorkspaceRootAndRelativePath(workDir, path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, relative))
	if err != nil {
		return "", err
	}
	if err := EnsureUnderWorkspace(root, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func ResolveWritePath(workDir string, path string) (string, error) {
	root, relative, err := WorkspaceRootAndRelativePath(workDir, path)
	if err != nil {
		return "", err
	}
	parent, err := EnsureWorkspaceParent(root, filepath.Dir(relative))
	if err != nil {
		return "", err
	}
	resolved := filepath.Join(parent, filepath.Base(relative))
	if info, err := os.Lstat(resolved); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("sandbox file paths must not traverse symlinks")
	}
	if err := EnsureUnderWorkspace(root, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func WorkspaceRootAndRelativePath(workDir string, path string) (string, string, error) {
	root, err := filepath.Abs(workDir)
	if err != nil {
		return "", "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", "", err
	}
	candidate := path
	if strings.HasPrefix(candidate, "/workspace/") {
		candidate = strings.TrimPrefix(candidate, "/workspace/")
	}
	if filepath.IsAbs(candidate) {
		return "", "", fmt.Errorf("sandbox file paths must stay under workspace")
	}
	relative := filepath.Clean(candidate)
	if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("sandbox file paths must stay under workspace")
	}
	return root, relative, nil
}

func EnsureWorkspaceParent(root string, relativeParent string) (string, error) {
	parent := root
	if relativeParent == "." {
		return parent, nil
	}
	for _, part := range strings.Split(relativeParent, string(filepath.Separator)) {
		next := filepath.Join(parent, part)
		info, err := os.Lstat(next)
		if os.IsNotExist(err) {
			if err := os.Mkdir(next, 0o755); err != nil {
				return "", err
			}
			parent = next
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("sandbox file paths must not traverse symlinks")
		}
		if !info.IsDir() {
			return "", fmt.Errorf("sandbox file parent must be a directory")
		}
		parent = next
	}
	return parent, EnsureUnderWorkspace(root, parent)
}

func EnsureUnderWorkspace(root string, resolved string) error {
	resolved, err := filepath.Abs(resolved)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("sandbox file paths must stay under workspace")
	}
	return nil
}

func AsExitError(err error, target **exec.ExitError) bool {
	if exitError, ok := err.(*exec.ExitError); ok {
		*target = exitError
		return true
	}
	return false
}
