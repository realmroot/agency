package workspace

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestAgentSnapshotHelpersFilterAndFormatValues(t *testing.T) {
	snapshot := map[string]any{
		"skills": []any{" review ", "", 42, "triage"},
		"subagents": []any{
			map[string]any{"name": " reviewer ", "description": " Reviews code "},
			map[string]any{"description": "missing name"},
			"invalid",
		},
	}
	if got := agentStringArray(snapshot["skills"]); strings.Join(got, ",") != "review,triage" {
		t.Fatalf("unexpected string array %v", got)
	}
	if got := agentSkillRefs(snapshot); strings.Join(got, ",") != "review,triage" {
		t.Fatalf("unexpected skill refs %v", got)
	}
	if got := agentSubagentSummaries(snapshot["subagents"]); strings.Join(got, ",") != "@reviewer (Reviews code)" {
		t.Fatalf("unexpected subagent summaries %v", got)
	}
	if got := agentCapabilitiesSection(map[string]any{}); got != "" {
		t.Fatalf("expected empty capabilities section, got %q", got)
	}
}

func TestPrepareAgentNoopsForNilInputs(t *testing.T) {
	if err := (*Workspace)(nil).PrepareAgent(context.Background(), "codex", map[string]any{"systemPrompt": "ignored"}); err != nil {
		t.Fatalf("nil workspace should be a no-op: %v", err)
	}
	if err := (&Workspace{Cwd: t.TempDir()}).PrepareAgent(context.Background(), "codex", nil); err != nil {
		t.Fatalf("nil snapshot should be a no-op: %v", err)
	}
}

func TestPrepareAgentReturnsSkillInstallError(t *testing.T) {
	if err := (&Workspace{Cwd: t.TempDir()}).PrepareAgent(context.Background(), "codex", map[string]any{
		"skills": []any{"bad-ref"},
	}); err == nil || !strings.Contains(err.Error(), "stable <source>@<skill>") {
		t.Fatalf("expected invalid skill ref error, got %v", err)
	}
}

func TestInstallAgentSkillValidatesReferenceAndRunsForInstalledSkill(t *testing.T) {
	cwd := t.TempDir()
	if err := installAgentSkill(context.Background(), cwd, "codex", "bad-ref"); err == nil || !strings.Contains(err.Error(), "stable <source>@<skill>") {
		t.Fatalf("expected invalid ref error, got %v", err)
	}
	installFakeNpx(t, `#!/bin/sh
echo "$*" > npx.args
printf '{"review":"v1"}' > skills-lock.json
exit 0
`)
	installed := filepath.Join(cwd, ".agents", "skills", "review", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(installed), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(installed, []byte("# Review\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := installAgentSkill(context.Background(), cwd, "codex", "enbor@review"); err != nil {
		t.Fatalf("expected installed skill refresh success: %v", err)
	}
	args, err := os.ReadFile(filepath.Join(cwd, "npx.args"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "skills add enbor --skill review --agent universal -y") {
		t.Fatalf("expected npx skills add args, got %q", string(args))
	}
}

func TestRefreshAgentSkillReportsLockChanges(t *testing.T) {
	t.Run("installed", func(t *testing.T) {
		installFakeNpx(t, `#!/bin/sh
printf '{"review":"v1"}' > skills-lock.json
exit 0
`)
		change, err := refreshAgentSkill(context.Background(), t.TempDir(), "codex", "enbor@review")
		if err != nil {
			t.Fatal(err)
		}
		if change == nil || change.Ref != "enbor@review" || change.Status != "installed" {
			t.Fatalf("expected installed change, got %#v", change)
		}
	})

	t.Run("updated", func(t *testing.T) {
		installFakeNpx(t, `#!/bin/sh
printf '{"review":"v2"}' > skills-lock.json
exit 0
`)
		cwd := t.TempDir()
		if err := os.WriteFile(filepath.Join(cwd, SkillsLockFileName), []byte(`{"review":"v1"}`), 0o644); err != nil {
			t.Fatal(err)
		}
		change, err := refreshAgentSkill(context.Background(), cwd, "codex", "enbor@review")
		if err != nil {
			t.Fatal(err)
		}
		if change == nil || change.Ref != "enbor@review" || change.Status != "updated" {
			t.Fatalf("expected updated change, got %#v", change)
		}
	})

	t.Run("unchanged", func(t *testing.T) {
		installFakeNpx(t, `#!/bin/sh
printf '{"review":"v1"}' > skills-lock.json
exit 0
`)
		cwd := t.TempDir()
		if err := os.WriteFile(filepath.Join(cwd, SkillsLockFileName), []byte(`{"review":"v1"}`), 0o644); err != nil {
			t.Fatal(err)
		}
		change, err := refreshAgentSkill(context.Background(), cwd, "codex", "enbor@review")
		if err != nil {
			t.Fatal(err)
		}
		if change != nil {
			t.Fatalf("expected unchanged skill to report no change, got %#v", change)
		}
	})
}

func TestInstallAgentSkillRunsNpxAndReportsFailures(t *testing.T) {
	t.Run("failure", func(t *testing.T) {
		installFakeNpx(t, `#!/bin/sh
echo install failed
exit 9
`)
		err := installAgentSkill(context.Background(), t.TempDir(), "claude-code", "enbor@review")
		if err == nil || !strings.Contains(err.Error(), "install failed") {
			t.Fatalf("expected npx failure output, got %v", err)
		}
	})
	t.Run("success", func(t *testing.T) {
		installFakeNpx(t, `#!/bin/sh
exit 0
`)
		cwd := t.TempDir()
		if err := installAgentSkill(context.Background(), cwd, "codex", "enbor@review"); err != nil {
			t.Fatalf("expected npx install success, got %v", err)
		}
		if _, err := os.Stat(filepath.Join(cwd, ".gitignore")); err != nil {
			t.Fatalf("expected successful install to update gitignore, got %v", err)
		}
	})
}

func installFakeNpx(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "npx.sh")
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	executablePath := filepath.Join(dir, "npx")
	if runtime.GOOS == "windows" {
		executablePath += ".cmd"
		if err := os.WriteFile(executablePath, []byte("@echo off\r\nsh \"%~dp0npx.sh\" %*\r\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	} else if err := os.Rename(scriptPath, executablePath); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestEnsureAgentSkillGitignoreIsIdempotent(t *testing.T) {
	cwd := t.TempDir()
	if err := ensureAgentSkillGitignore(cwd); err != nil {
		t.Fatalf("ensure gitignore: %v", err)
	}
	if err := ensureAgentSkillGitignore(cwd); err != nil {
		t.Fatalf("ensure gitignore again: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, entry := range []string{".claude/skills/", ".agents/", "skills-lock.json"} {
		if strings.Count(text, entry) != 1 {
			t.Fatalf("expected one %q entry, got:\n%s", entry, text)
		}
	}
}

func TestMaterializeSubagentsByRuntime(t *testing.T) {
	profiles := []subagentProfile{{
		Name:          "reviewer",
		Description:   "Reviews code",
		SystemPrompt:  `Use """ carefully.`,
		Model:         "gpt-5",
		AllowedTools:  []string{"read", "bash", "fetch", "unknown"},
		MCPConnectors: []string{"github"},
	}}
	cases := []struct {
		runtimeName string
		path        string
		contains    []string
	}{
		{
			runtimeName: "codex",
			path:        filepath.Join(".codex", "agents", "reviewer.toml"),
			contains:    []string{`name = "reviewer"`, `model = "gpt-5"`, `developer_instructions = """`},
		},
		{
			runtimeName: "claude-code",
			path:        filepath.Join(".claude", "agents", "reviewer.md"),
			contains:    []string{"tools: \"Read, Bash, WebFetch, unknown\"", "model: gpt-5"},
		},
		{
			runtimeName: "copilot",
			path:        filepath.Join(".github", "agents", "reviewer.agent.md"),
			contains:    []string{`tools: ["read", "bash", "fetch", "unknown"]`, `mcp-servers: ["github"]`},
		},
	}
	for _, tc := range cases {
		t.Run(tc.runtimeName, func(t *testing.T) {
			cwd := t.TempDir()
			if err := materializeSubagents(cwd, tc.runtimeName, profiles); err != nil {
				t.Fatalf("materialize subagent: %v", err)
			}
			data, err := os.ReadFile(filepath.Join(cwd, tc.path))
			if err != nil {
				t.Fatal(err)
			}
			text := string(data)
			for _, want := range tc.contains {
				if !strings.Contains(text, want) {
					t.Fatalf("expected %q in %s", want, text)
				}
			}
		})
	}
	if err := materializeSubagents(t.TempDir(), "enbor", profiles); err != nil {
		t.Fatalf("enbor runtime should not materialize subagents: %v", err)
	}
	if err := materializeSubagents(t.TempDir(), "unknown", profiles); err == nil {
		t.Fatal("expected unsupported runtime error")
	}
	if err := materializeSubagents(t.TempDir(), "codex", []subagentProfile{{Name: "../bad"}}); err == nil {
		t.Fatal("expected invalid subagent name error")
	}
}

func TestSubagentSnapshotHelpersAndScalars(t *testing.T) {
	profiles := agentSubagentProfiles(map[string]any{
		"subagents": []any{
			map[string]any{
				"name":          "reviewer",
				"description":   "Reviews: code",
				"systemPrompt":  "Review carefully.",
				"model":         "gpt-5",
				"allowedTools":  []any{"read", " ", 42, "write"},
				"skills":        []any{"review"},
				"mcpConnectors": []any{"github"},
			},
			"invalid",
		},
	})
	if len(profiles) != 1 || profiles[0].Name != "reviewer" || strings.Join(profiles[0].AllowedTools, ",") != "read,write" {
		t.Fatalf("unexpected subagent profiles %#v", profiles)
	}
	if got := yamlScalar("simple"); got != "simple" {
		t.Fatalf("expected safe scalar, got %q", got)
	}
	if got := yamlScalar("Reviews: code"); got != `"Reviews: code"` {
		t.Fatalf("expected quoted scalar, got %q", got)
	}
	if got := yamlArray([]string{"read", "write"}); got != `["read", "write"]` {
		t.Fatalf("unexpected yaml array %q", got)
	}
}
