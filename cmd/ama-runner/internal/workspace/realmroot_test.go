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

func installLegacyRealmrootCLI(t *testing.T) {
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

func legacyRealmrootState(t *testing.T, root string) []byte {
	return legacyRealmrootStateWith(t, root, nil)
}

func legacyRealmrootStateWith(t *testing.T, root string, values map[string]any) []byte {
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

func TestPrepareLegacyRealmrootAgentSkipsWithoutBindingAndRequiresCLI(t *testing.T) {
	if err := prepareLegacyRealmrootAgent(t.TempDir(), map[string]any{}); err != nil {
		t.Fatalf("expected an unbound legacy snapshot to skip preparation, got %v", err)
	}

	t.Setenv("PATH", t.TempDir())
	err := prepareLegacyRealmrootAgent(t.TempDir(), legacyRealmrootSnapshot())
	if err == nil || !strings.Contains(err.Error(), "realmroot is not installed") {
		t.Fatalf("expected missing CLI error, got %v", err)
	}
}

func TestValidateLegacyRealmrootStateRejectsInvalidIdentityState(t *testing.T) {
	binding := realmrootBinding{AgentID: "rr_agent_1", Origin: "https://realmroot.example.com"}
	for _, test := range []struct {
		name    string
		data    []byte
		values  map[string]any
		message string
	}{
		{name: "json", data: []byte("{"), message: "decode Realmroot Agent state"},
		{name: "version", values: map[string]any{"version": 17}, message: "version 18"},
		{name: "metadata", values: map[string]any{"host_id": ""}, message: "missing required identity metadata"},
		{name: "issuer", values: map[string]any{"issuer": "http://realmroot.example.com"}, message: "safe HTTPS URL"},
		{name: "key encoding", values: map[string]any{"agent_private_key": "not+base64url"}, message: "invalid Ed25519 private key"},
		{name: "key length", values: map[string]any{"agent_private_key": "AQ"}, message: "invalid Ed25519 private key"},
		{name: "agent", values: map[string]any{"agent_id": "rr_agent_other"}, message: "does not match"},
		{name: "origin", values: map[string]any{"origin": "https://other.example.com"}, message: "does not match"},
		{name: "runtime", values: map[string]any{"runtime": "codex"}, message: "AGENT=ama"},
	} {
		t.Run(test.name, func(t *testing.T) {
			data := test.data
			if data == nil {
				data = legacyRealmrootStateWith(t, t.TempDir(), test.values)
			}
			_, err := validateLegacyRealmrootState(data, binding)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("expected %q error, got %v", test.message, err)
			}
		})
	}
}

func TestPrepareLegacyRealmrootAgentReportsBoundaryFailures(t *testing.T) {
	installLegacyRealmrootCLI(t)

	t.Run("missing source", func(t *testing.T) {
		err := prepareLegacyRealmrootAgent(t.TempDir(), legacyRealmrootSnapshot())
		if err == nil || !strings.Contains(err.Error(), "read mounted Realmroot Agent state") {
			t.Fatalf("expected source read error, got %v", err)
		}
	})

	t.Run("existing issuer mismatch", func(t *testing.T) {
		root := t.TempDir()
		legacyRealmrootState(t, root)
		issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
		target := filepath.Join(
			root,
			filepath.FromSlash(realmrootStateDirPath),
			"identities",
			issuerDir,
			base64.RawURLEncoding.EncodeToString([]byte("ama"))+".json",
		)
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		existing := legacyRealmrootStateWith(t, t.TempDir(), map[string]any{
			"issuer": "https://other.example.com/api/auth",
		})
		if err := os.WriteFile(target, existing, 0o600); err != nil {
			t.Fatal(err)
		}
		err := prepareLegacyRealmrootAgent(root, legacyRealmrootSnapshot())
		if err == nil || !strings.Contains(err.Error(), "issuer does not match") {
			t.Fatalf("expected existing issuer mismatch, got %v", err)
		}
	})

	t.Run("directory protection", func(t *testing.T) {
		err := protectLegacyRealmrootDirectories(filepath.Join(t.TempDir(), "missing"), filepath.Join(t.TempDir(), "leaf"))
		if err == nil || !strings.Contains(err.Error(), "protect session Realmroot Agent state directory") {
			t.Fatalf("expected directory protection error, got %v", err)
		}
	})
}

func TestLegacyRealmrootBindingRejectsMalformedSnapshots(t *testing.T) {
	for _, test := range []struct {
		name     string
		snapshot map[string]any
		message  string
	}{
		{name: "string", snapshot: map[string]any{"realmroot": "bound"}, message: "must be an object"},
		{name: "array", snapshot: map[string]any{"realmroot": []any{}}, message: "must be an object"},
		{name: "blank", snapshot: map[string]any{"realmroot": map[string]any{"agentId": " ", "origin": ""}}, message: "requires agentId and origin"},
		{name: "wrong type", snapshot: map[string]any{"realmroot": map[string]any{"agentId": 1, "origin": "https://realmroot.example.com"}}, message: "requires agentId and origin"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, ok, err := realmrootBindingFromSnapshot(test.snapshot)
			if err == nil || ok || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("expected malformed binding error %q, got ok=%v err=%v", test.message, ok, err)
			}
		})
	}
}

func TestNormalizeLegacyRealmrootOriginRejectsUnsafeURLs(t *testing.T) {
	for _, value := range []string{
		"%",
		"realmroot.example.com",
		"https:///missing-host",
		"https://user@realmroot.example.com",
		"https://realmroot.example.com?query=1",
		"https://realmroot.example.com/#fragment",
	} {
		if got := normalizeLegacyRealmrootOrigin(value); got != "" {
			t.Fatalf("expected unsafe origin %q to be rejected, got %q", value, got)
		}
	}
	if got := normalizeLegacyRealmrootOrigin("https://realmroot.example.com/api/"); got != "https://realmroot.example.com/api" {
		t.Fatalf("expected trailing slash normalization, got %q", got)
	}
}

func legacyRealmrootSnapshot() map[string]any {
	return map[string]any{
		"realmroot": map[string]any{
			"agentId":       "rr_agent_1",
			"origin":        "https://realmroot.example.com",
			"credentialRef": "ama://vaults/vault_1/credentials/cred_1",
		},
	}
}

func TestPrepareLegacyRealmrootAgentCopiesSourceIntoWritableSessionState(t *testing.T) {
	installLegacyRealmrootCLI(t)
	root := t.TempDir()
	source := legacyRealmrootState(t, root)

	if err := prepareLegacyRealmrootAgent(root, legacyRealmrootSnapshot()); err != nil {
		t.Fatalf("expected legacy Realmroot preparation success, got %v", err)
	}
	issuerDir := base64.RawURLEncoding.EncodeToString([]byte("https://realmroot.example.com/api/auth"))
	target := filepath.Join(
		root,
		filepath.FromSlash(realmrootStateDirPath),
		"identities",
		issuerDir,
		base64.RawURLEncoding.EncodeToString([]byte("ama"))+".json",
	)
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(source) {
		t.Fatalf("expected exact legacy state copy, got %s", got)
	}

	var evolved map[string]any
	if err := json.Unmarshal(got, &evolved); err != nil {
		t.Fatal(err)
	}
	evolved["protocol_credential"] = map[string]any{"access_token": "refreshed"}
	evolvedData, err := json.Marshal(evolved)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, evolvedData, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := prepareLegacyRealmrootAgent(root, legacyRealmrootSnapshot()); err != nil {
		t.Fatalf("expected repeat legacy preparation success, got %v", err)
	}
	preserved, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(preserved) != string(evolvedData) {
		t.Fatalf("expected writable session state to survive repeat preparation, got %s", preserved)
	}
}
