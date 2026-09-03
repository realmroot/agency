package workspace

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/samber/lo"
)

const SkillsLockFileName = "skills-lock.json"

type SkillRefreshChange struct {
	Ref    string
	Status string
}

type AgentPrepareReport struct {
	SkillChanges []SkillRefreshChange
}

func agentCapabilitiesSection(agentSnapshot map[string]any) string {
	parts := []string{}
	if skills := agentStringArray(agentSnapshot["skills"]); len(skills) > 0 {
		parts = append(parts, "Skills: "+strings.Join(skills, ", "))
	}
	if subagents := agentSubagentSummaries(agentSnapshot["subagents"]); len(subagents) > 0 {
		parts = append(parts, "Available subagents: "+strings.Join(subagents, ", "))
	}
	if len(parts) == 0 {
		return ""
	}
	return "## Agent Capabilities\n\n" + strings.Join(parts, "\n")
}

func agentStringArray(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(item any, _ int) (string, bool) {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text), true
		}
		return "", false
	})
}

func agentSubagentSummaries(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(item any, _ int) (string, bool) {
		subagent, ok := item.(map[string]any)
		if !ok {
			return "", false
		}
		name, _ := subagent["name"].(string)
		description, _ := subagent["description"].(string)
		label := strings.TrimSpace(name)
		if label == "" {
			return "", false
		}
		if strings.TrimSpace(description) != "" {
			label += " (" + strings.TrimSpace(description) + ")"
		}
		return "@" + label, true
	})
}

func agentSkillRefs(agentSnapshot map[string]any) []string {
	raw, ok := agentSnapshot["skills"].([]any)
	if !ok {
		return nil
	}
	return lo.FilterMap(raw, func(value any, _ int) (string, bool) {
		if skill, ok := value.(string); ok && strings.TrimSpace(skill) != "" {
			return strings.TrimSpace(skill), true
		}
		return "", false
	})
}

func installAgentSkill(ctx context.Context, cwd string, runtimeName string, ref string) error {
	_, err := refreshAgentSkill(ctx, cwd, runtimeName, ref)
	return err
}

func refreshAgentSkill(ctx context.Context, cwd string, runtimeName string, ref string) (*SkillRefreshChange, error) {
	at := strings.LastIndex(ref, "@")
	if at <= 0 || at == len(ref)-1 {
		return nil, fmt.Errorf("agent skill must be a stable <source>@<skill> reference: %s", ref)
	}
	source := ref[:at]
	skill := ref[at+1:]
	before, hadLock, err := readSkillsLock(cwd)
	if err != nil {
		return nil, err
	}
	agent := "universal"
	if runtimeName == "claude-code" {
		agent = "claude-code"
	}
	args := []string{"skills", "add", source, "--skill", skill, "--agent", agent, "-y"}
	cmd := exec.CommandContext(ctx, "npx", args...)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("install agent skill %s failed: %w: %s", ref, err, strings.TrimSpace(string(output)))
	}
	after, _, err := readSkillsLock(cwd)
	if err != nil {
		return nil, err
	}
	if err := ensureAgentSkillGitignore(cwd); err != nil {
		return nil, err
	}
	if before == after {
		return nil, nil
	}
	status := "updated"
	if !hadLock {
		status = "installed"
	}
	return &SkillRefreshChange{Ref: ref, Status: status}, nil
}

func readSkillsLock(cwd string) (string, bool, error) {
	data, err := os.ReadFile(filepath.Join(cwd, SkillsLockFileName))
	if err != nil {
		if os.IsNotExist(err) {
			return "", false, nil
		}
		return "", false, err
	}
	return string(data), true, nil
}

func ensureAgentSkillGitignore(cwd string) error {
	return ensureGitignoreEntries(cwd, "# agent skills (managed by Enbor Runner)", []string{".claude/skills/", ".agents/", SkillsLockFileName})
}

func ensureGitignoreEntries(cwd string, comment string, entries []string) error {
	path := filepath.Join(cwd, ".gitignore")
	existingBytes, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	existing := string(existingBytes)
	missing := lo.Reject(entries, func(entry string, _ int) bool {
		return strings.Contains(existing, entry)
	})
	if len(missing) == 0 {
		return nil
	}
	appendix := "\n" + comment + "\n" + strings.Join(missing, "\n") + "\n"
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString(appendix)
	return err
}
