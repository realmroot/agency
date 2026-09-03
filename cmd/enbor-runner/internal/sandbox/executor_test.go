package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/host"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/workspace"
)

func TestWorkspaceRootAndRelativePathRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	gotRoot, relative, err := WorkspaceRootAndRelativePath(root, "/workspace/nested/file.txt")
	if err != nil {
		t.Fatalf("expected /workspace path to resolve: %v", err)
	}
	if gotRoot == "" || relative != filepath.Join("nested", "file.txt") {
		t.Fatalf("unexpected workspace path result root=%q relative=%q", gotRoot, relative)
	}
	for _, path := range []string{"../outside", "/tmp/outside", "/workspace/../outside"} {
		if _, _, err := WorkspaceRootAndRelativePath(root, path); err == nil {
			t.Fatalf("expected %q to be rejected", path)
		}
	}
}

func TestEnsureWorkspaceParentRejectsUnsafeParents(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file-parent"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureWorkspaceParent(root, filepath.Join("file-parent", "child")); err == nil {
		t.Fatal("expected file parent error")
	}

	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link-parent")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := EnsureWorkspaceParent(root, filepath.Join("link-parent", "child")); err == nil {
		t.Fatal("expected symlink parent error")
	}
}

func TestEnsureUnderWorkspaceRejectsOutsidePath(t *testing.T) {
	root := t.TempDir()
	if err := EnsureUnderWorkspace(root, filepath.Dir(root)); err == nil {
		t.Fatal("expected outside workspace error")
	}
}

func TestAsExitErrorIgnoresNonExitErrors(t *testing.T) {
	var exitErr *exec.ExitError
	if AsExitError(os.ErrPermission, &exitErr) || exitErr != nil {
		t.Fatal("expected non-exit error not to match exec.ExitError")
	}
}

func TestResolveWritePathRejectsSymlinkParents(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveWritePath(root, filepath.Join("link", "file.txt")); err == nil {
		t.Fatal("expected symlink parent to be rejected")
	}
}

func TestProcessCommandEnvironmentUsesSessionPrivateDirs(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "sessions", "session_1", "workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	env, err := ProcessCommandEnvironment(workspace)
	if err != nil {
		t.Fatal(err)
	}
	sessionDir, err := filepath.EvalSymlinks(filepath.Dir(workspace))
	if err != nil {
		t.Fatal(err)
	}
	joined := "\n" + strings.Join(env, "\n") + "\n"
	if !strings.Contains(joined, "\nHOME="+filepath.Join(sessionDir, ".home")+"\n") {
		t.Fatalf("expected session-private HOME in env: %v", env)
	}
	if !strings.Contains(joined, "\nAMA_WORKSPACE_HOME="+filepath.Join(sessionDir, ".home")+"\n") {
		t.Fatalf("expected session-private AMA_WORKSPACE_HOME in env: %v", env)
	}
}

func TestProcessAdapterExecutesSandboxExecInWorkdir(t *testing.T) {
	requireProcessAdapter(t)
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "pwd && printf ok"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected command success, got %v", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	if !strings.Contains(stdout, workDir) || !strings.Contains(stdout, "ok") {
		t.Fatalf("unexpected stdout %q", stdout)
	}
	if result.Output["exitCode"] != 0 {
		t.Fatalf("unexpected exit code %#v", result.Output["exitCode"])
	}
}

func TestProcessAdapterMergesRequestEnvironment(t *testing.T) {
	requireProcessAdapter(t)
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "printf '%s:%s' \"$CUSTOM_TOKEN\" \"$GH_TOKEN\""},
		WorkDir:  workDir,
		Env: map[string]string{
			"CUSTOM_TOKEN": "custom-value",
			"GH_TOKEN":     "github-value",
		},
	})
	if err != nil {
		t.Fatalf("expected command success, got %v", err)
	}
	if result.Output["stdout"] != "custom-value:github-value" {
		t.Fatalf("expected request env in process, got %#v", result.Output)
	}
}

func TestProcessAdapterRejectsReservedRequestEnvironment(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	for _, key := range []string{"AMA_SESSION_ID", "ama_codex_sandbox_mode", "Ama_Claude_Code_Permission_Mode"} {
		_, err := adapter.Execute(context.Background(), ToolRequest{
			ToolName: "bash",
			Input:    map[string]any{"command": "env"},
			WorkDir:  t.TempDir(),
			Env:      map[string]string{key: "override"},
		})
		if err == nil || !strings.Contains(err.Error(), "reserved") {
			t.Fatalf("expected reserved env error for %q, got %v", key, err)
		}
	}
}

func TestProcessAdapterValidatesToolsAndInputs(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	workDir := t.TempDir()
	cases := []ToolRequest{
		{ToolName: "sandbox.unknown", WorkDir: workDir},
		{ToolName: "bash", Input: map[string]any{"command": " "}, WorkDir: workDir},
		{ToolName: "read", Input: map[string]any{}, WorkDir: workDir},
		{ToolName: "write", Input: map[string]any{"path": " "}, WorkDir: workDir},
		{ToolName: "write", Input: map[string]any{"path": "file.txt"}, WorkDir: workDir},
	}
	for _, request := range cases {
		if _, err := adapter.Execute(context.Background(), request); err == nil {
			t.Fatalf("expected %s with input %#v to fail", request.ToolName, request.Input)
		}
	}
}

func TestProcessAdapterReadAndWrite(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	workDir := t.TempDir()
	if _, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "notes/plan.md", "content": "ship it"},
		WorkDir:  workDir,
	}); err != nil {
		t.Fatalf("write tool failed: %v", err)
	}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "/workspace/notes/plan.md"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("read tool failed: %v", err)
	}
	if result.Output["content"] != "ship it" {
		t.Fatalf("unexpected read result %#v", result.Output)
	}
}

func TestProcessAdapterEdit(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	workDir := t.TempDir()
	path := filepath.Join(workDir, "notes.txt")
	if err := os.WriteFile(path, []byte("alpha\nbeta\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "edit",
		Input: map[string]any{
			"path": "notes.txt",
			"edits": []any{
				map[string]any{"oldText": "alpha", "newText": "ALPHA"},
				map[string]any{"oldText": "beta", "newText": "BETA"},
			},
		},
		WorkDir: workDir,
	})
	if err != nil {
		t.Fatalf("edit tool failed: %v", err)
	}
	if result.Output["ok"] != true {
		t.Fatalf("unexpected edit output %#v", result.Output)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "ALPHA\nBETA\n" {
		t.Fatalf("unexpected edited file %q", string(data))
	}
}

func TestProcessAdapterEditValidatesInputs(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "notes.txt"), []byte("alpha\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cases := []map[string]any{
		{"path": "notes.txt"},
		{"path": "notes.txt", "edits": []any{}},
		{"path": "notes.txt", "edits": []any{"bad"}},
		{"path": "notes.txt", "edits": []any{map[string]any{"oldText": "", "newText": "x"}}},
		{"path": "notes.txt", "edits": []any{map[string]any{"oldText": "alpha"}}},
		{"path": "notes.txt", "edits": []any{map[string]any{"oldText": "missing", "newText": "x"}}},
	}
	for _, input := range cases {
		if _, err := adapter.Execute(context.Background(), ToolRequest{
			ToolName: "edit",
			Input:    input,
			WorkDir:  workDir,
		}); err == nil {
			t.Fatalf("expected edit input %#v to fail", input)
		}
	}
}

func TestProcessAdapterFindSupportsGlob(t *testing.T) {
	requireProcessAdapter(t)
	if _, err := exec.LookPath("rg"); err != nil {
		t.Skip("rg is required for find glob support")
	}
	workDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workDir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "src", "app.test.ts"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "src", "app.ts"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}

	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "find",
		Input:    map[string]any{"glob": "**/*.test.ts", "path": "."},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("find tool failed: %v", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	if !strings.Contains(stdout, "src/app.test.ts") || strings.Contains(stdout, "src/app.ts") {
		t.Fatalf("unexpected find output %q", stdout)
	}
}

func TestProcessAdapterListAndGrep(t *testing.T) {
	requireProcessAdapter(t)
	if _, err := exec.LookPath("rg"); err != nil {
		t.Skip("rg is required for grep support")
	}
	workDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workDir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "src", "app.go"), []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "README.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	list, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "ls",
		Input:    map[string]any{"path": ".", "limit": 10},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("ls tool failed: %v", err)
	}
	if stdout, _ := list.Output["stdout"].(string); !strings.Contains(stdout, "README.md") || !strings.Contains(stdout, "src") {
		t.Fatalf("unexpected ls output %q", stdout)
	}

	grep, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "grep",
		Input:    map[string]any{"pattern": "FUNC MAIN", "path": "src", "ignoreCase": true, "literal": true, "limit": 1},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("grep tool failed: %v", err)
	}
	if stdout, _ := grep.Output["stdout"].(string); !strings.Contains(stdout, "app.go") || !strings.Contains(stdout, "func main") {
		t.Fatalf("unexpected grep output %q", stdout)
	}
}

func TestSandboxToolCommandBuilders(t *testing.T) {
	grep := grepCommand(map[string]any{
		"pattern":    "hello world",
		"path":       "src",
		"ignoreCase": true,
		"literal":    true,
		"glob":       "**/*.go",
		"context":    float64(2),
		"limit":      float64(5),
	})
	for _, expected := range []string{
		"rg --line-number --color never",
		"--ignore-case",
		"--fixed-strings",
		"--glob '**/*.go'",
		"--context 2",
		"--max-count 5",
		"'hello world' 'src'",
	} {
		if !strings.Contains(grep, expected) {
			t.Fatalf("expected grep command to contain %q, got %q", expected, grep)
		}
	}

	if findCommand(map[string]any{"pattern": "test", "path": "src", "limit": 3}) != "find 'src' -type f -name '*test*' -print | head -n 3" {
		t.Fatalf("unexpected find pattern command")
	}
	if findCommand(map[string]any{"path": "src"}) != "" {
		t.Fatalf("expected find without pattern or glob to return empty command")
	}
	if lsCommand(map[string]any{"path": "src", "limit": 2}) != "find 'src' -maxdepth 1 -mindepth 1 -print | sort | head -n 2" {
		t.Fatalf("unexpected ls command")
	}
	if fetchCommand(map[string]any{"url": "https://example.com/a'b"}) != "curl -fsS --max-time 60 'https://example.com/a'\\''b'" {
		t.Fatalf("unexpected fetch command")
	}
	web := webSearchCommand(map[string]any{"query": "hello world", "limit": 99})
	if !strings.Contains(web, "hello+world") || !strings.Contains(web, "head -n 200") {
		t.Fatalf("unexpected web search command %q", web)
	}
}

func TestSandboxInputHelpers(t *testing.T) {
	input := map[string]any{"zero": 0, "float": float64(3), "negative": -1, "fraction": 1.5, "blank": " "}
	if OptionalStringInput(input, "blank", "fallback") != "fallback" {
		t.Fatalf("expected blank optional string to use fallback")
	}
	if PositiveIntInput(input, "zero", 9) != 0 {
		t.Fatalf("expected zero to be accepted")
	}
	if PositiveIntInput(input, "float", 9) != 3 {
		t.Fatalf("expected integral float to be accepted")
	}
	if PositiveIntInput(input, "negative", 9) != 9 || PositiveIntInput(input, "fraction", 9) != 9 {
		t.Fatalf("expected invalid positive ints to use fallback")
	}
}

func TestProcessAdapterExecReportsFailureAndTimeout(t *testing.T) {
	requireProcessAdapter(t)
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "printf out; printf err >&2; exit 7"},
		WorkDir:  workDir,
	})
	if err == nil || err.Error() != "command exited with code 7; output is available in the structured tool result" {
		t.Fatalf("expected exit error, got %v", err)
	}
	if result.Output["exitCode"] != 7 || result.Output["stdout"] != "out" || result.Output["stderr"] != "err" {
		t.Fatalf("unexpected failed output %#v", result.Output)
	}

	timeoutAdapter := ProcessAdapter{CommandTimeout: time.Millisecond, ShutdownGraceInterval: time.Millisecond}
	if _, err := timeoutAdapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "sleep 1"},
		WorkDir:  workDir,
	}); err == nil {
		t.Fatal("expected command timeout")
	}
}

func TestProcessAdapterBoundsStructuredFailureOutputWithoutLeakingItInError(t *testing.T) {
	requireProcessAdapter(t)
	const (
		limit          = 64 * 1024
		stdoutSentinel = "stdout-sensitive-sentinel"
		stderrSentinel = "stderr-sensitive-sentinel"
	)
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input: map[string]any{"command": `
			awk 'BEGIN { printf "discarded-stdout-prefix"; for (i = 0; i < 70000; i++) printf "o"; printf "stdout-sensitive-sentinel" }'
			awk 'BEGIN { printf "discarded-stderr-prefix"; for (i = 0; i < 70000; i++) printf "e"; printf "stderr-sensitive-sentinel" }' >&2
			exit 9
		`},
		WorkDir: t.TempDir(),
	})
	if err == nil || err.Error() != "command exited with code 9; output is available in the structured tool result" {
		t.Fatalf("expected generic command error, got %v", err)
	}
	if strings.Contains(err.Error(), stdoutSentinel) || strings.Contains(err.Error(), stderrSentinel) {
		t.Fatalf("generic error leaked structured output: %q", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	stderr, _ := result.Output["stderr"].(string)
	if len(stdout) != limit || !strings.HasSuffix(stdout, stdoutSentinel) || strings.Contains(stdout, "discarded-stdout-prefix") {
		t.Fatalf("stdout was not retained as a %d-byte tail: length=%d suffix=%q", limit, len(stdout), stdout[len(stdout)-len(stdoutSentinel):])
	}
	if len(stderr) != limit || !strings.HasSuffix(stderr, stderrSentinel) || strings.Contains(stderr, "discarded-stderr-prefix") {
		t.Fatalf("stderr was not retained as a %d-byte tail: length=%d suffix=%q", limit, len(stderr), stderr[len(stderr)-len(stderrSentinel):])
	}
}

func TestProcessAdapterDoesNotExposeDaemonAMAEnvironment(t *testing.T) {
	requireProcessAdapter(t)
	operatorHome := t.TempDir()
	t.Setenv("AMA_TOKEN", "secret-token")
	t.Setenv("AMA_ORIGIN", "https://ama.example.com")
	t.Setenv("AMA_RUNNER_NAME", "operator-runner")
	t.Setenv("AMA_RUNNER_ALLOW_UNSAFE_PROCESS", "true")
	t.Setenv("AMA_RUNNER_OPERATOR_SECRET", "runner-operator-secret")
	t.Setenv("AMA_CUSTOM_SECRET", "custom-operator-secret")
	t.Setenv("HOME", operatorHome)

	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	result, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "env"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected command success, got %v", err)
	}
	stdout, _ := result.Output["stdout"].(string)
	for _, leaked := range []string{
		"AMA_TOKEN=", "secret-token",
		"AMA_ORIGIN=",
		"AMA_RUNNER_NAME=", "operator-runner",
		"AMA_RUNNER_ALLOW_UNSAFE_PROCESS=",
		"AMA_RUNNER_OPERATOR_SECRET=", "runner-operator-secret",
		"AMA_CUSTOM_SECRET=", "custom-operator-secret",
		operatorHome,
	} {
		if strings.Contains(stdout, leaked) {
			t.Fatalf("expected scrubbed Enbor environment, found %q in %q", leaked, stdout)
		}
	}
	resolvedWorkDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	workspaceHome := filepath.Join(resolvedWorkDir, ".home")
	workspaceTemp := filepath.Join(resolvedWorkDir, ".tmp")
	for _, expected := range []string{"HOME=" + workspaceHome, "TMPDIR=" + workspaceTemp, "TEMP=" + workspaceTemp, "TMP=" + workspaceTemp} {
		if !strings.Contains(stdout, expected) {
			t.Fatalf("expected workspace-scoped environment %q, got %q", expected, stdout)
		}
	}
	if !strings.Contains(stdout, "PATH=") {
		t.Fatalf("expected minimal command environment to include PATH, got %q", stdout)
	}
}

func TestProcessCommandEnvironmentUsesSessionPrivateDirsForRuntimeWorkspace(t *testing.T) {
	sessionDir := filepath.Join(t.TempDir(), "sessions", "session_1")
	workDir := filepath.Join(sessionDir, workspace.WorkspaceDirName)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	env, err := ProcessCommandEnvironment(workDir)
	if err != nil {
		t.Fatalf("expected command environment success, got %v", err)
	}
	resolvedSessionDir, err := filepath.EvalSymlinks(sessionDir)
	if err != nil {
		t.Fatal(err)
	}
	sessionHome := filepath.Join(resolvedSessionDir, ".home")
	sessionTemp := filepath.Join(resolvedSessionDir, ".tmp")
	joined := strings.Join(env, "\n")
	for _, expected := range []string{
		"HOME=" + sessionHome,
		"AMA_WORKSPACE_HOME=" + sessionHome,
		"GH_CONFIG_DIR=" + filepath.Join(sessionHome, ".config", "gh"),
		"GIT_CONFIG_GLOBAL=" + filepath.Join(sessionHome, ".gitconfig"),
		"GIT_CONFIG_NOSYSTEM=1",
		"TMPDIR=" + sessionTemp,
		"TEMP=" + sessionTemp,
		"TMP=" + sessionTemp,
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected session-scoped environment %q, got %q", expected, joined)
		}
	}
	for _, unexpected := range []string{
		filepath.Join(workDir, ".home"),
		filepath.Join(workDir, ".tmp"),
	} {
		if strings.Contains(joined, unexpected) {
			t.Fatalf("expected no workspace-local process directory %q, got %q", unexpected, joined)
		}
	}
}

func TestProcessCommandEnvironmentKeepsOrdinaryWorkspaceDirsLocal(t *testing.T) {
	parent := t.TempDir()
	workDir := filepath.Join(parent, workspace.WorkspaceDirName)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	env, err := ProcessCommandEnvironment(workDir)
	if err != nil {
		t.Fatalf("expected command environment success, got %v", err)
	}
	resolvedWorkDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(env, "\n")
	for _, expected := range []string{
		"HOME=" + filepath.Join(resolvedWorkDir, ".home"),
		"TMPDIR=" + filepath.Join(resolvedWorkDir, ".tmp"),
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected workspace-local environment %q, got %q", expected, joined)
		}
	}
}

func TestProcessEnvironmentHelpersValidateExistingDirs(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	envRoot := ProcessEnvironmentRoot(root)
	if envRoot != root {
		t.Fatalf("ordinary workdir environment root = %q, want %q", envRoot, root)
	}
	home, err := PrepareProcessEnvironmentDir(root, ".home")
	if err != nil {
		t.Fatalf("expected process env dir creation success, got %v", err)
	}
	if home != filepath.Join(root, ".home") {
		t.Fatalf("unexpected process env dir %q", home)
	}
	if _, err := PrepareProcessEnvironmentDir(root, ".home"); err != nil {
		t.Fatalf("expected existing process env dir success, got %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".tmp"), []byte("file"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareProcessEnvironmentDir(root, ".tmp"); err == nil || !strings.Contains(err.Error(), "directory") {
		t.Fatalf("expected file process env dir error, got %v", err)
	}
}

func TestProcessCommandEnvironmentFailsWhenWorkspaceHomeOrTempCannotBeCreated(t *testing.T) {
	fileWorkDir := filepath.Join(t.TempDir(), "workspace-file")
	if err := os.WriteFile(fileWorkDir, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ProcessCommandEnvironment(fileWorkDir); err == nil {
		t.Fatal("expected home directory creation error")
	}

	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, ".tmp"), []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ProcessCommandEnvironment(workDir); err == nil {
		t.Fatal("expected temp directory creation error")
	}
}

func TestProcessAdapterRejectsSymlinkedEnvironmentDirectories(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	for _, name := range []string{".home", ".tmp"} {
		workDir := t.TempDir()
		outside := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(workDir, name)); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		marker := filepath.Join(workDir, "ran")
		_, err := adapter.Execute(context.Background(), ToolRequest{
			ToolName: "bash",
			Input:    map[string]any{"command": "touch ran"},
			WorkDir:  workDir,
		})
		if err == nil || !strings.Contains(err.Error(), "symlinks") {
			t.Fatalf("expected symlink environment directory rejection for %s, got %v", name, err)
		}
		if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
			t.Fatalf("expected command not to run for %s, marker stat error %v", name, statErr)
		}
	}
}

func TestProcessAdapterRejectsPathsOutsideWorkspace(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "../secret.txt"},
		WorkDir:  t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected path boundary error")
	}
	if !strings.Contains(err.Error(), "under workspace") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestProcessAdapterRejectsSymlinkWorkspaceEscapes(t *testing.T) {
	workDir := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(outsideFile, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(workDir, "readlink")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(workDir, "writelink")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "readlink"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "under workspace") {
		t.Fatalf("expected read symlink boundary error, got %v", err)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "writelink/out.txt", "content": "bad"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("expected write symlink boundary error, got %v", err)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "readlink", "content": "bad"},
		WorkDir:  workDir,
	})
	if err == nil || !strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("expected final symlink write error, got %v", err)
	}
}

func TestProcessAdapterReadsAndWritesInsideWorkspace(t *testing.T) {
	workDir := t.TempDir()
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	write, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "notes/todo.txt", "content": "done"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected write success, got %v", err)
	}
	if write.Output["ok"] != true {
		t.Fatalf("unexpected write output %#v", write.Output)
	}
	if content, err := os.ReadFile(filepath.Join(workDir, "notes", "todo.txt")); err != nil || string(content) != "done" {
		t.Fatalf("unexpected written content %q, %v", content, err)
	}
	read, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "/workspace/notes/todo.txt"},
		WorkDir:  workDir,
	})
	if err != nil {
		t.Fatalf("expected read success, got %v", err)
	}
	if read.Output["content"] != "done" {
		t.Fatalf("unexpected read output %#v", read.Output)
	}
}

func TestProcessAdapterValidatesReadWriteInputs(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	fileWorkDir := filepath.Join(t.TempDir(), "workspace-file")
	if err := os.WriteFile(fileWorkDir, []byte("not a dir"), 0o644); err != nil {
		t.Fatal(err)
	}
	tests := []ToolRequest{
		{ToolName: "read", Input: map[string]any{}, WorkDir: t.TempDir()},
		{ToolName: "read", Input: map[string]any{"path": "missing.txt"}, WorkDir: t.TempDir()},
		{ToolName: "write", Input: map[string]any{"path": "x"}, WorkDir: t.TempDir()},
		{ToolName: "write", Input: map[string]any{"path": "../x", "content": "bad"}, WorkDir: t.TempDir()},
		{ToolName: "write", Input: map[string]any{"path": "child.txt", "content": "bad"}, WorkDir: fileWorkDir},
	}
	for _, request := range tests {
		if _, err := adapter.Execute(context.Background(), request); err == nil {
			t.Fatalf("expected validation error for %#v", request)
		}
	}
}

func TestProcessAdapterRejectsSymlinkEscapes(t *testing.T) {
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	workDir := t.TempDir()
	if err := os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(workDir, "secret-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workDir, "outside-dir")); err != nil {
		t.Fatal(err)
	}
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, readErr := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "read",
		Input:    map[string]any{"path": "secret-link"},
		WorkDir:  workDir,
	})
	if readErr == nil || !strings.Contains(readErr.Error(), "under workspace") {
		t.Fatalf("expected symlink read escape rejection, got %v", readErr)
	}
	_, writeErr := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "write",
		Input:    map[string]any{"path": "outside-dir/new.txt", "content": "bad"},
		WorkDir:  workDir,
	})
	if writeErr == nil || !strings.Contains(writeErr.Error(), "symlinks") {
		t.Fatalf("expected symlink write escape rejection, got %v", writeErr)
	}
}

func TestProcessAdapterReportsCommandFailureAndTimeout(t *testing.T) {
	requireProcessAdapter(t)
	adapter := ProcessAdapter{CommandTimeout: 500 * time.Millisecond, ShutdownGraceInterval: 50 * time.Millisecond}
	failed, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "printf bad >&2; exit 7"},
		WorkDir:  t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected command failure")
	}
	if failed.Output["exitCode"] != 7 {
		t.Fatalf("unexpected failure output %#v", failed.Output)
	}
	_, err = adapter.Execute(context.Background(), ToolRequest{
		ToolName: "bash",
		Input:    map[string]any{"command": "sleep 1"},
		WorkDir:  t.TempDir(),
	})
	if err == nil || !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("expected timeout error, got %v", err)
	}
}

func requireProcessAdapter(t *testing.T) {
	t.Helper()
	if !host.SupportsAMARuntime() {
		t.Skip("process adapter is unavailable on this host")
	}
}

func TestProcessAdapterRejectsUnsupportedTools(t *testing.T) {
	adapter := ProcessAdapter{CommandTimeout: time.Second, ShutdownGraceInterval: time.Millisecond}
	_, err := adapter.Execute(context.Background(), ToolRequest{
		ToolName: "mcp.github.repo.read",
		Input:    map[string]any{},
		WorkDir:  t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected unsupported tool error")
	}
}
