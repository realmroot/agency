package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func reviewerSnapshot() map[string]any {
	return map[string]any{
		"systemPrompt": "Follow the Enbor runtime protocol.",
		"subagents": []any{
			map[string]any{
				"name":          "reviewer",
				"description":   "Reviews pull requests for correctness",
				"systemPrompt":  "Be strict about error handling.",
				"model":         "gpt-5.3-codex",
				"allowedTools":  []any{"read", "grep", "web_search"},
				"skills":        []any{},
				"mcpConnectors": []any{"github"},
			},
		},
	}
}

func TestPrepareAgentWorkspaceWritesClaudeSubagentDefinition(t *testing.T) {
	cwd := t.TempDir()
	if err := (&Workspace{Cwd: cwd}).PrepareAgent(context.Background(), "claude-code", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".claude", "agents", "reviewer.md"))
	if err != nil {
		t.Fatalf("expected claude subagent definition, got %v", err)
	}
	want := `---
name: reviewer
description: Reviews pull requests for correctness
tools: "Read, Grep, WebSearch"
model: gpt-5.3-codex
---
Be strict about error handling.
`
	if string(content) != want {
		t.Fatalf("unexpected claude subagent file:\n%s\nwant:\n%s", content, want)
	}
	gitignore, err := os.ReadFile(filepath.Join(cwd, ".gitignore"))
	if err != nil || !strings.Contains(string(gitignore), ".claude/agents/") {
		t.Fatalf("expected .claude/agents/ gitignore entry, got %q err=%v", gitignore, err)
	}
}

func TestAgentSubagentProfilesFiltersInvalidSnapshotItems(t *testing.T) {
	profiles := agentSubagentProfiles(map[string]any{
		"subagents": []any{
			"skip",
			map[string]any{
				"name":          "reviewer",
				"description":   " Reviews code ",
				"systemPrompt":  "Be direct.",
				"model":         "gpt-5.3-codex",
				"allowedTools":  []any{"read", "", " ", 42, "grep"},
				"skills":        []any{"review", nil},
				"mcpConnectors": []any{"github", ""},
			},
		},
	})
	if len(profiles) != 1 {
		t.Fatalf("expected one valid profile, got %#v", profiles)
	}
	profile := profiles[0]
	if profile.Name != "reviewer" || profile.Description != " Reviews code " || profile.SystemPrompt != "Be direct." {
		t.Fatalf("unexpected profile strings %#v", profile)
	}
	if strings.Join(profile.AllowedTools, ",") != "read,grep" {
		t.Fatalf("unexpected allowed tools %#v", profile.AllowedTools)
	}
	if strings.Join(profile.Skills, ",") != "review" {
		t.Fatalf("unexpected skills %#v", profile.Skills)
	}
	if strings.Join(profile.MCPConnectors, ",") != "github" {
		t.Fatalf("unexpected mcp connectors %#v", profile.MCPConnectors)
	}
	if profiles := agentSubagentProfiles(map[string]any{"subagents": "none"}); profiles != nil {
		t.Fatalf("expected non-array subagents to return nil, got %#v", profiles)
	}
}

func TestPrepareAgentWorkspaceWritesCopilotCommonSubagentDefinition(t *testing.T) {
	cwd := t.TempDir()
	if err := (&Workspace{Cwd: cwd}).PrepareAgent(context.Background(), "copilot", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".github", "agents", "reviewer.agent.md"))
	if err != nil {
		t.Fatalf("expected copilot subagent definition, got %v", err)
	}
	want := `---
name: reviewer
description: Reviews pull requests for correctness
tools: ["read", "grep", "web_search"]
model: gpt-5.3-codex
mcp-servers: ["github"]
---
Be strict about error handling.
`
	if string(content) != want {
		t.Fatalf("unexpected copilot subagent file:\n%s\nwant:\n%s", content, want)
	}
	gitignore, err := os.ReadFile(filepath.Join(cwd, ".gitignore"))
	if err != nil || !strings.Contains(string(gitignore), ".github/agents/") {
		t.Fatalf("expected .github/agents/ gitignore entry, got %q err=%v", gitignore, err)
	}
}

func TestPrepareAgentWorkspaceWritesCodexSubagentTOML(t *testing.T) {
	cwd := t.TempDir()
	if err := (&Workspace{Cwd: cwd}).PrepareAgent(context.Background(), "codex", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".codex", "agents", "reviewer.toml"))
	if err != nil {
		t.Fatalf("expected codex subagent definition, got %v", err)
	}
	want := `name = "reviewer"
description = "Reviews pull requests for correctness"
model = "gpt-5.3-codex"
developer_instructions = """
Be strict about error handling.
"""
`
	if string(content) != want {
		t.Fatalf("unexpected codex subagent file:\n%s\nwant:\n%s", content, want)
	}
	gitignore, err := os.ReadFile(filepath.Join(cwd, ".gitignore"))
	if err != nil || !strings.Contains(string(gitignore), ".codex/agents/") {
		t.Fatalf("expected .codex/agents/ gitignore entry, got %q err=%v", gitignore, err)
	}
}

func TestPrepareAgentWorkspaceDoesNotWriteSystemPromptFile(t *testing.T) {
	cwd := t.TempDir()
	if err := (&Workspace{Cwd: cwd}).PrepareAgent(context.Background(), "codex", reviewerSnapshot()); err != nil {
		t.Fatalf("expected workspace preparation success, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(cwd, ".enbor", "system-prompt.md")); !os.IsNotExist(err) {
		t.Fatalf("expected no system prompt file in workspace, got err=%v", err)
	}
}

func TestMaterializeSubagentsQuotesUnsafeValues(t *testing.T) {
	cwd := t.TempDir()
	subagents := []subagentProfile{{
		Name:         "docs-writer",
		Description:  `Writes "friendly" docs`,
		SystemPrompt: "Write docs.",
	}}
	if err := materializeSubagents(cwd, "claude-code", subagents); err != nil {
		t.Fatalf("expected materialize success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".claude", "agents", "docs-writer.md"))
	if err != nil {
		t.Fatalf("expected subagent definition, got %v", err)
	}
	if !strings.Contains(string(content), `description: "Writes \"friendly\" docs"`) {
		t.Fatalf("expected quoted YAML scalar, got:\n%s", content)
	}
}

func TestMaterializeSubagentsEscapesCodexTripleQuotes(t *testing.T) {
	cwd := t.TempDir()
	subagents := []subagentProfile{{
		Name:         "tester",
		Description:  "Tests generated code.",
		SystemPrompt: `Use """ blocks carefully.`,
	}}
	if err := materializeSubagents(cwd, "codex", subagents); err != nil {
		t.Fatalf("expected materialize success, got %v", err)
	}
	content, err := os.ReadFile(filepath.Join(cwd, ".codex", "agents", "tester.toml"))
	if err != nil {
		t.Fatalf("expected codex subagent definition, got %v", err)
	}
	if !strings.Contains(string(content), `Use \"\"\" blocks carefully.`) {
		t.Fatalf("expected escaped triple quotes, got:\n%s", content)
	}
}

func TestMaterializeSubagentsRejectsUnsafeNamesAndUnsupportedRuntimes(t *testing.T) {
	cwd := t.TempDir()
	err := materializeSubagents(cwd, "claude-code", []subagentProfile{{Name: "../escape"}})
	if err == nil || !strings.Contains(err.Error(), "single path segment") {
		t.Fatalf("expected unsafe name error, got %v", err)
	}
	err = materializeSubagents(cwd, "unknown", []subagentProfile{{Name: "reviewer"}})
	if err == nil || !strings.Contains(err.Error(), "does not support workspace subagent definitions") {
		t.Fatalf("expected unsupported runtime error, got %v", err)
	}
	if err := materializeSubagents(cwd, "enbor", []subagentProfile{{Name: "reviewer"}}); err != nil {
		t.Fatalf("expected enbor runtime to ignore workspace subagent files, got %v", err)
	}
}

func TestClaudeToolNamesMapsCanonicalSandboxTools(t *testing.T) {
	got := claudeToolNames([]string{
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"fetch",
		"web_search",
		"custom_tool",
	})
	want := []string{
		"Read",
		"Bash",
		"Edit",
		"Write",
		"Grep",
		"Glob",
		"WebFetch",
		"WebSearch",
		"custom_tool",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("claude tool names = %#v, want %#v", got, want)
	}
}

func TestMaterializeSubagentsSkipsWhenSnapshotHasNoSubagents(t *testing.T) {
	cwd := t.TempDir()
	if err := materializeSubagents(cwd, "enbor", nil); err != nil {
		t.Fatalf("expected no-op for empty subagent list, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(cwd, ".gitignore")); !os.IsNotExist(err) {
		t.Fatalf("expected no gitignore changes, got %v", err)
	}
}
