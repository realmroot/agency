package workspace

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/samber/lo"
)

type subagentProfile struct {
	Name          string
	Description   string
	SystemPrompt  string
	Model         string
	AllowedTools  []string
	Skills        []string
	MCPConnectors []string
}

func agentSubagentProfiles(agentSnapshot map[string]any) []subagentProfile {
	raw, ok := agentSnapshot["subagents"].([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(item any, _ int) (subagentProfile, bool) {
		entry, ok := item.(map[string]any)
		if !ok {
			return subagentProfile{}, false
		}
		return subagentProfile{
			Name:          snapshotString(entry["name"]),
			Description:   snapshotString(entry["description"]),
			SystemPrompt:  snapshotString(entry["systemPrompt"]),
			Model:         snapshotString(entry["model"]),
			AllowedTools:  snapshotStringArray(entry["allowedTools"]),
			Skills:        snapshotStringArray(entry["skills"]),
			MCPConnectors: snapshotStringArray(entry["mcpConnectors"]),
		}, true
	})
}

func snapshotString(value any) string {
	text, _ := value.(string)
	return text
}

func snapshotStringArray(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(item any, _ int) (string, bool) {
		text, ok := item.(string)
		text = strings.TrimSpace(text)
		return text, ok && text != ""
	})
}

// materializeSubagents writes runtime-native subagent definitions into the
// session worktree. Enbor's first-party runtime reads the structured snapshot
// directly, so it does not need workspace files.
func materializeSubagents(cwd string, runtimeName string, subagents []subagentProfile) error {
	if len(subagents) == 0 {
		return nil
	}
	var gitignoreEntry string
	switch runtimeName {
	case "ama":
		return nil
	case "claude-code":
		gitignoreEntry = ".claude/agents/"
	case "codex":
		gitignoreEntry = ".codex/agents/"
	case "copilot":
		gitignoreEntry = ".github/agents/"
	default:
		return fmt.Errorf("runtime %q does not support workspace subagent definitions", runtimeName)
	}
	for _, agent := range subagents {
		name := agent.Name
		if strings.TrimSpace(name) == "" || name == "." || name == ".." || filepath.Base(name) != name {
			return fmt.Errorf("subagent name %q must be a single path segment", name)
		}
		var relativePath, content string
		switch runtimeName {
		case "codex":
			relativePath = filepath.Join(".codex", "agents", name+".toml")
			content = renderCodexSubagent(agent)
		case "claude-code":
			relativePath = filepath.Join(".claude", "agents", name+".md")
			content = renderClaudeSubagent(agent)
		case "copilot":
			relativePath = filepath.Join(".github", "agents", name+".agent.md")
			content = renderCommonSubagent(agent)
		}
		path := filepath.Join(cwd, relativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return err
		}
	}
	return ensureGitignoreEntries(cwd, "# agent definitions (managed by Enbor Runner)", []string{gitignoreEntry})
}

func renderClaudeSubagent(agent subagentProfile) string {
	lines := []string{
		"---",
		"name: " + yamlScalar(agent.Name),
		"description: " + yamlScalar(agent.Description),
	}
	if len(agent.AllowedTools) > 0 {
		lines = append(lines, "tools: "+yamlScalar(strings.Join(claudeToolNames(agent.AllowedTools), ", ")))
	}
	if agent.Model != "" {
		lines = append(lines, "model: "+yamlScalar(agent.Model))
	}
	lines = append(lines, "---")
	return strings.Join(lines, "\n") + "\n" + agent.SystemPrompt + "\n"
}

func renderCommonSubagent(agent subagentProfile) string {
	lines := []string{
		"---",
		"name: " + yamlScalar(agent.Name),
		"description: " + yamlScalar(agent.Description),
	}
	if len(agent.AllowedTools) > 0 {
		lines = append(lines, "tools: "+yamlArray(agent.AllowedTools))
	}
	if agent.Model != "" {
		lines = append(lines, "model: "+yamlScalar(agent.Model))
	}
	if len(agent.MCPConnectors) > 0 {
		lines = append(lines, "mcp-servers: "+yamlArray(agent.MCPConnectors))
	}
	lines = append(lines, "---")
	return strings.Join(lines, "\n") + "\n" + agent.SystemPrompt + "\n"
}

func renderCodexSubagent(agent subagentProfile) string {
	lines := []string{
		"name = " + jsonString(agent.Name),
		"description = " + jsonString(agent.Description),
	}
	if agent.Model != "" {
		lines = append(lines, "model = "+jsonString(agent.Model))
	}
	escapedPrompt := strings.ReplaceAll(agent.SystemPrompt, `"""`, `\"\"\"`)
	lines = append(lines, `developer_instructions = """`+"\n"+escapedPrompt+"\n"+`"""`)
	return strings.Join(lines, "\n") + "\n"
}

func claudeToolNames(tools []string) []string {
	return lo.Map(tools, func(tool string, _ int) string {
		switch tool {
		case "read":
			return "Read"
		case "bash":
			return "Bash"
		case "edit":
			return "Edit"
		case "write":
			return "Write"
		case "grep":
			return "Grep"
		case "find":
			return "Glob"
		case "fetch":
			return "WebFetch"
		case "web_search":
			return "WebSearch"
		default:
			return tool
		}
	})
}

func yamlScalar(value string) string {
	safe := value != "" &&
		!strings.ContainsAny(value, ":#\"'\n\t{}[]&*!|>%@`,") &&
		value == strings.TrimSpace(value) &&
		!strings.HasPrefix(value, "-") &&
		!strings.HasPrefix(value, "?")
	if safe {
		return value
	}
	return jsonString(value)
}

func yamlArray(values []string) string {
	return "[" + strings.Join(lo.Map(values, func(value string, _ int) string { return jsonString(value) }), ", ") + "]"
}

// jsonString encodes a string as a JSON literal, which is also a valid YAML
// double-quoted scalar and TOML basic string.
func jsonString(value string) string {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		panic(err)
	}
	return strings.TrimSuffix(buffer.String(), "\n")
}
