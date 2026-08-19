package workspace

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	realmrootSourceStatePath = ".ama/realmroot-source/state.json"
	realmrootStateDirPath    = ".ama/realmroot-state"
)

type realmrootBinding struct {
	AgentID string
	Origin  string
}

type realmrootStateMetadata struct {
	Version                  int    `json:"version"`
	AgentID                  string `json:"agent_id"`
	Origin                   string `json:"origin"`
	Issuer                   string `json:"issuer"`
	Runtime                  string `json:"runtime"`
	HostID                   string `json:"host_id"`
	AgentKeyID               string `json:"agent_key_id"`
	AgentPrivateKey          string `json:"agent_private_key"`
	EnrollmentIdempotencyKey string `json:"enrollment_idempotency_key"`
}

func prepareRealmrootAgent(root string, snapshot map[string]any) error {
	binding, ok, err := realmrootBindingFromSnapshot(snapshot)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if _, err := exec.LookPath("realmroot"); err != nil {
		return fmt.Errorf("Realmroot Agent is bound but realmroot is not installed on the runner: %w", err)
	}
	source := filepath.Join(root, filepath.FromSlash(realmrootSourceStatePath))
	data, err := os.ReadFile(source)
	if err != nil {
		return fmt.Errorf("read mounted Realmroot Agent state: %w", err)
	}
	state, err := validateRealmrootState(data, binding)
	if err != nil {
		return err
	}
	targetDir := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities", base64.RawURLEncoding.EncodeToString([]byte(state.Issuer)))
	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		return fmt.Errorf("create Realmroot Agent state directory: %w", err)
	}
	if err := protectRealmrootDirectories(filepath.Join(root, filepath.FromSlash(realmrootStateDirPath)), targetDir); err != nil {
		return err
	}
	target := filepath.Join(targetDir, "ama.json")
	existing, err := os.ReadFile(target)
	if err == nil {
		existingState, err := validateRealmrootState(existing, binding)
		if err != nil {
			return fmt.Errorf("validate session Realmroot Agent state: %w", err)
		}
		if existingState.Issuer != state.Issuer {
			return fmt.Errorf("session Realmroot Agent state issuer does not match the bound credential")
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("read session Realmroot Agent state: %w", err)
	} else if err := os.WriteFile(target, data, 0o600); err != nil {
		return fmt.Errorf("write session Realmroot Agent state: %w", err)
	}
	if err := os.Chmod(target, 0o600); err != nil {
		return fmt.Errorf("protect session Realmroot Agent state: %w", err)
	}
	return nil
}

func validateRealmrootState(data []byte, binding realmrootBinding) (realmrootStateMetadata, error) {
	var state realmrootStateMetadata
	if err := json.Unmarshal(data, &state); err != nil {
		return state, fmt.Errorf("decode Realmroot Agent state: %w", err)
	}
	if state.Version != 18 {
		return state, fmt.Errorf("Realmroot Agent state must use version 18")
	}
	if state.AgentID == "" || state.Origin == "" || state.Issuer == "" || state.Runtime == "" ||
		state.HostID == "" || state.AgentKeyID == "" || state.EnrollmentIdempotencyKey == "" {
		return state, fmt.Errorf("Realmroot Agent state is missing required identity metadata")
	}
	if normalizeRealmrootOrigin(state.Issuer) == "" {
		return state, fmt.Errorf("Realmroot Agent state issuer must be a safe HTTPS URL")
	}
	privateKey, err := base64.RawURLEncoding.DecodeString(state.AgentPrivateKey)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return state, fmt.Errorf("Realmroot Agent state contains an invalid Ed25519 private key")
	}
	if state.AgentID != binding.AgentID || normalizeRealmrootOrigin(state.Origin) != normalizeRealmrootOrigin(binding.Origin) {
		return state, fmt.Errorf("Realmroot Agent credential does not match the bound Agent id and origin")
	}
	if state.Runtime != "ama" {
		return state, fmt.Errorf("Realmroot Agent credential must be enrolled with AGENT=ama")
	}
	return state, nil
}

func realmrootBindingFromSnapshot(snapshot map[string]any) (realmrootBinding, bool, error) {
	value, exists := snapshot["realmroot"]
	if !exists || value == nil {
		return realmrootBinding{}, false, nil
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return realmrootBinding{}, false, fmt.Errorf("Realmroot Agent binding must be an object")
	}
	agentID, _ := raw["agentId"].(string)
	origin, _ := raw["origin"].(string)
	if strings.TrimSpace(agentID) == "" || strings.TrimSpace(origin) == "" {
		return realmrootBinding{}, false, fmt.Errorf("Realmroot Agent binding requires agentId and origin")
	}
	return realmrootBinding{AgentID: agentID, Origin: origin}, true, nil
}

func normalizeRealmrootOrigin(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	return parsed.String()
}

func protectRealmrootDirectories(root string, leaf string) error {
	for _, directory := range []string{root, filepath.Join(root, "identities"), leaf} {
		if err := os.Chmod(directory, 0o700); err != nil {
			return fmt.Errorf("protect Realmroot Agent state directory: %w", err)
		}
	}
	return nil
}

func (w *Workspace) RuntimeEnv(env map[string]string) map[string]string {
	resolved := make(map[string]string, len(env))
	for key, value := range env {
		resolved[key] = value
	}
	if w != nil && resolved["REALMROOT_STATE_DIR"] == "/workspace/.ama/realmroot-state" {
		resolved["REALMROOT_STATE_DIR"] = filepath.Join(w.Root, filepath.FromSlash(realmrootStateDirPath))
	}
	return resolved
}
