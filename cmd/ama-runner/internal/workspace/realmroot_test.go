package workspace

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
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
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"version":                    18,
		"agent_id":                   "rr_agent_1",
		"origin":                     "https://realmroot.example.com",
		"issuer":                     "https://realmroot.example.com/api/auth",
		"runtime":                    "ama",
		"host_id":                    "host_1",
		"agent_key_id":               "key_1",
		"agent_private_key":          "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw",
		"enrollment_idempotency_key": "enroll_1",
	})
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
