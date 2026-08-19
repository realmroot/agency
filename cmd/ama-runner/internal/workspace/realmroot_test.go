package workspace

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func installFakeRealmroot(t *testing.T) {
	t.Helper()
	bin := t.TempDir()
	name := "realmroot"
	contents := []byte("#!/bin/sh\nexit 0\n")
	if runtime.GOOS == "windows" {
		name = "realmroot.bat"
		contents = []byte("@exit /b 0\r\n")
	}
	if err := os.WriteFile(filepath.Join(bin, name), contents, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func realmrootState(t *testing.T, root string, values map[string]any) []byte {
	t.Helper()
	state := map[string]any{
		"version":                    18,
		"agent_id":                   "rr_agent_1",
		"origin":                     "https://realmroot.example.com",
		"issuer":                     "https://realmroot.example.com/api/auth",
		"runtime":                    "ama",
		"host_id":                    "host_1",
		"agent_key_id":               "key_1",
		"agent_private_key":          "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw",
		"enrollment_idempotency_key": "enroll_1",
	}
	for key, value := range values {
		state[key] = value
	}
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, filepath.FromSlash(realmrootSourceStatePath))
	if err := os.MkdirAll(filepath.Dir(source), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, data, 0o400); err != nil {
		t.Fatal(err)
	}
	return data
}

func realmrootSnapshot() map[string]any {
	return map[string]any{
		"realmroot": map[string]any{
			"agentId":       "rr_agent_1",
			"origin":        "https://realmroot.example.com",
			"credentialRef": "ama://vaults/vault_1/credentials/cred_1",
		},
	}
}

func TestPrepareRealmrootAgentCreatesPrivateSessionState(t *testing.T) {
	installFakeRealmroot(t)
	root := t.TempDir()
	data := realmrootState(t, root, nil)

	if err := prepareRealmrootAgent(root, realmrootSnapshot()); err != nil {
		t.Fatalf("expected Realmroot preparation success, got %v", err)
	}
	issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
	target := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities", issuerDir, "ama.json")
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(data) {
		t.Fatalf("expected exact private state copy, got %s", got)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("expected state mode 0600, got %o", info.Mode().Perm())
	}
	for _, dir := range []string{
		filepath.Join(root, filepath.FromSlash(realmrootStateDirPath)),
		filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities"),
		filepath.Dir(target),
	} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0o700 {
			t.Fatalf("expected private directory mode 0700 for %s, got %o", dir, info.Mode().Perm())
		}
	}
}

func TestPrepareRealmrootAgentRejectsMismatchedOrNonAMAState(t *testing.T) {
	installFakeRealmroot(t)
	for _, tc := range []struct {
		name    string
		values  map[string]any
		message string
	}{
		{name: "agent", values: map[string]any{"agent_id": "rr_agent_other"}, message: "does not match"},
		{name: "origin", values: map[string]any{"origin": "https://other.example.com"}, message: "does not match"},
		{name: "runtime", values: map[string]any{"runtime": "codex"}, message: "AGENT=ama"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			realmrootState(t, root, tc.values)
			err := prepareRealmrootAgent(root, realmrootSnapshot())
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("expected %q error, got %v", tc.message, err)
			}
		})
	}
}

func TestPrepareRealmrootAgentPreservesExistingWritableState(t *testing.T) {
	installFakeRealmroot(t)
	root := t.TempDir()
	realmrootState(t, root, nil)
	if err := prepareRealmrootAgent(root, realmrootSnapshot()); err != nil {
		t.Fatalf("first preparation failed: %v", err)
	}
	issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
	target := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities", issuerDir, "ama.json")
	var evolved map[string]any
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &evolved); err != nil {
		t.Fatal(err)
	}
	evolved["protocol_credential"] = map[string]any{
		"resource_indicator":    "https://realmroot.example.com/",
		"authorization_details": []any{},
		"credential_endpoint":   "https://realmroot.example.com/api/credentials",
		"proof_target":          "https://realmroot.example.com/",
		"private_key":           "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
		"access_token":          "refreshed",
		"expires_at":            "2026-09-01T00:00:00.000Z",
		"scopes":                []string{"agent:operate"},
	}
	evolvedData, err := json.Marshal(evolved)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, evolvedData, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := prepareRealmrootAgent(root, realmrootSnapshot()); err != nil {
		t.Fatalf("second preparation failed: %v", err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(evolvedData) {
		t.Fatalf("expected evolved session state to survive, got %s", got)
	}
}

func TestPrepareRealmrootAgentSkipsWithoutBindingAndRequiresCLI(t *testing.T) {
	if err := prepareRealmrootAgent(t.TempDir(), map[string]any{}); err != nil {
		t.Fatalf("expected unbound workspace to skip preparation, got %v", err)
	}

	t.Setenv("PATH", t.TempDir())
	err := prepareRealmrootAgent(t.TempDir(), realmrootSnapshot())
	if err == nil || !strings.Contains(err.Error(), "realmroot is not installed") {
		t.Fatalf("expected missing CLI error, got %v", err)
	}
}

func TestPrepareRealmrootAgentReportsFilesystemFailures(t *testing.T) {
	installFakeRealmroot(t)

	t.Run("read mounted state", func(t *testing.T) {
		err := prepareRealmrootAgent(t.TempDir(), realmrootSnapshot())
		if err == nil || !strings.Contains(err.Error(), "read mounted Realmroot Agent state") {
			t.Fatalf("expected source read error, got %v", err)
		}
	})

	t.Run("create state directory", func(t *testing.T) {
		root := t.TempDir()
		realmrootState(t, root, nil)
		statePath := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath))
		if err := os.MkdirAll(filepath.Dir(statePath), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(statePath, []byte("occupied"), 0o600); err != nil {
			t.Fatal(err)
		}
		err := prepareRealmrootAgent(root, realmrootSnapshot())
		if err == nil || !strings.Contains(err.Error(), "create Realmroot Agent state directory") {
			t.Fatalf("expected directory creation error, got %v", err)
		}
	})

	t.Run("read existing state", func(t *testing.T) {
		root := t.TempDir()
		realmrootState(t, root, nil)
		issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
		target := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities", issuerDir, "ama.json")
		if err := os.MkdirAll(target, 0o700); err != nil {
			t.Fatal(err)
		}
		err := prepareRealmrootAgent(root, realmrootSnapshot())
		if err == nil || !strings.Contains(err.Error(), "read session Realmroot Agent state") {
			t.Fatalf("expected existing state read error, got %v", err)
		}
	})

	t.Run("protect directory", func(t *testing.T) {
		err := protectRealmrootDirectories(filepath.Join(t.TempDir(), "missing"), filepath.Join(t.TempDir(), "leaf"))
		if err == nil || !strings.Contains(err.Error(), "protect Realmroot Agent state directory") {
			t.Fatalf("expected directory protection error, got %v", err)
		}
	})

	if runtime.GOOS != "windows" {
		t.Run("write state", func(t *testing.T) {
			root := t.TempDir()
			realmrootState(t, root, nil)
			issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
			targetDir := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities", issuerDir)
			if err := os.MkdirAll(targetDir, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(filepath.Join(root, "missing", "ama.json"), filepath.Join(targetDir, "ama.json")); err != nil {
				t.Fatal(err)
			}
			err := prepareRealmrootAgent(root, realmrootSnapshot())
			if err == nil || !strings.Contains(err.Error(), "write session Realmroot Agent state") {
				t.Fatalf("expected state write error, got %v", err)
			}
		})
	}
}

func TestPrepareRealmrootAgentRejectsInvalidExistingState(t *testing.T) {
	installFakeRealmroot(t)
	for _, tc := range []struct {
		name     string
		existing map[string]any
		message  string
	}{
		{name: "invalid", existing: map[string]any{"version": 17}, message: "validate session Realmroot Agent state"},
		{name: "issuer mismatch", existing: map[string]any{"issuer": "https://other.example.com/api/auth"}, message: "issuer does not match"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			realmrootState(t, root, nil)
			issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
			target := filepath.Join(root, filepath.FromSlash(realmrootStateDirPath), "identities", issuerDir, "ama.json")
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				t.Fatal(err)
			}
			data := realmrootState(t, t.TempDir(), tc.existing)
			if err := os.WriteFile(target, data, 0o600); err != nil {
				t.Fatal(err)
			}
			err := prepareRealmrootAgent(root, realmrootSnapshot())
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("expected %q error, got %v", tc.message, err)
			}
		})
	}
}

func TestValidateRealmrootStateRejectsMalformedIdentityState(t *testing.T) {
	binding := realmrootBinding{AgentID: "rr_agent_1", Origin: "https://realmroot.example.com"}
	for _, tc := range []struct {
		name    string
		data    []byte
		values  map[string]any
		message string
	}{
		{name: "JSON", data: []byte("{"), message: "decode Realmroot Agent state"},
		{name: "version", values: map[string]any{"version": 17}, message: "version 18"},
		{name: "required metadata", values: map[string]any{"host_id": ""}, message: "missing required identity metadata"},
		{name: "unsafe issuer", values: map[string]any{"issuer": "http://realmroot.example.com"}, message: "issuer must be a safe HTTPS URL"},
		{name: "key encoding", values: map[string]any{"agent_private_key": "not+base64url"}, message: "invalid Ed25519 private key"},
		{name: "key length", values: map[string]any{"agent_private_key": "AQ"}, message: "invalid Ed25519 private key"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := tc.data
			if data == nil {
				data = realmrootState(t, t.TempDir(), tc.values)
			}
			_, err := validateRealmrootState(data, binding)
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("expected %q error, got %v", tc.message, err)
			}
		})
	}
}

func TestNormalizeRealmrootOriginRejectsUnsafeURLs(t *testing.T) {
	for _, value := range []string{
		"%",
		"realmroot.example.com",
		"https:///missing-host",
		"https://user@realmroot.example.com",
		"https://realmroot.example.com?query=1",
		"https://realmroot.example.com/#fragment",
	} {
		if got := normalizeRealmrootOrigin(value); got != "" {
			t.Fatalf("expected unsafe origin %q to be rejected, got %q", value, got)
		}
	}
	if got := normalizeRealmrootOrigin("https://realmroot.example.com/api/"); got != "https://realmroot.example.com/api" {
		t.Fatalf("expected trailing slash normalization, got %q", got)
	}
}

func TestRealmrootRuntimeEnvRewritesSessionStatePath(t *testing.T) {
	workspace := &Workspace{Root: filepath.Join(t.TempDir(), "workspace")}
	input := map[string]string{
		"AGENT":               "ama",
		"REALMROOT_STATE_DIR": "/workspace/.ama/realmroot-state",
	}
	resolved := workspace.RuntimeEnv(input)

	expected := filepath.Join(workspace.Root, filepath.FromSlash(realmrootStateDirPath))
	if resolved["REALMROOT_STATE_DIR"] != expected {
		t.Fatalf("expected rewritten state path %q, got %q", expected, resolved["REALMROOT_STATE_DIR"])
	}
	if input["REALMROOT_STATE_DIR"] != "/workspace/.ama/realmroot-state" {
		t.Fatal("RuntimeEnv mutated the caller environment")
	}
}

func TestRealmrootBindingSnapshotAbsentOrNullSkipsPreparation(t *testing.T) {
	for _, snapshot := range []map[string]any{{}, {"realmroot": nil}} {
		binding, ok, err := realmrootBindingFromSnapshot(snapshot)
		if err != nil || ok || binding != (realmrootBinding{}) {
			t.Fatalf("expected absent binding to skip, got binding=%#v ok=%v err=%v", binding, ok, err)
		}
	}
}

func TestRealmrootBindingSnapshotRejectsMalformedValues(t *testing.T) {
	for _, tc := range []struct {
		name     string
		snapshot map[string]any
		message  string
	}{
		{name: "string", snapshot: map[string]any{"realmroot": "bound"}, message: "must be an object"},
		{name: "array", snapshot: map[string]any{"realmroot": []any{}}, message: "must be an object"},
		{name: "blank", snapshot: map[string]any{"realmroot": map[string]any{"agentId": " ", "origin": ""}}, message: "requires agentId and origin"},
		{name: "wrong field type", snapshot: map[string]any{"realmroot": map[string]any{"agentId": 1, "origin": "https://realmroot.example.com"}}, message: "requires agentId and origin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, ok, err := realmrootBindingFromSnapshot(tc.snapshot)
			if err == nil || ok || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("expected malformed binding error %q, got ok=%v err=%v", tc.message, ok, err)
			}
		})
	}
}
