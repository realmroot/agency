package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCredentialProfilesSaveLoadSwitchAndLogout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	first := CredentialProfile{
		AccountID:    " acct_1 ",
		APIServer:    "https://ama.example.test/",
		Email:        " one@example.test ",
		Name:         " One ",
		AccessToken:  "token-1",
		RefreshToken: "refresh-1",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	if err := SaveCredentialProfile(path, first); err != nil {
		t.Fatalf("save first profile: %v", err)
	}
	second := CredentialProfile{
		AccountID:   "acct_2",
		APIServer:   "https://ama.example.test",
		Email:       "two@example.test",
		Name:        "Two",
		AccessToken: "token-2",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	if err := SaveCredentialProfile(path, second); err != nil {
		t.Fatalf("save second profile: %v", err)
	}

	active, err := LoadActiveCredentialProfile(path)
	if err != nil {
		t.Fatalf("load active profile: %v", err)
	}
	if active == nil || active.AccountID != "acct_2" || active.APIServer != "https://ama.example.test" {
		t.Fatalf("unexpected active profile %#v", active)
	}
	if _, err := selectCredentialProfile(CredentialStore{Profiles: []CredentialProfile{
		{AccountID: "acct_1", APIServer: "https://ama.example.test"},
		{AccountID: "acct_2", APIServer: "https://ama.example.test"},
	}}, "https://ama.example.test", ""); err == nil || !strings.Contains(err.Error(), "multiple saved accounts") {
		t.Fatalf("expected multiple account error, got %v", err)
	}

	switched, err := SwitchCredentialProfile(path, "https://ama.example.test/", "one@example.test")
	if err != nil {
		t.Fatalf("switch profile: %v", err)
	}
	if switched.AccountID != "acct_1" || switched.Email != "one@example.test" || switched.Name != "One" {
		t.Fatalf("unexpected switched profile %#v", switched)
	}
	loaded, err := LoadCredentialProfile(path, "")
	if err != nil {
		t.Fatalf("load switched active profile: %v", err)
	}
	if loaded == nil || loaded.AccessToken != "token-1" {
		t.Fatalf("unexpected loaded profile %#v", loaded)
	}

	if err := LogoutCredentialProfile(path, ""); err != nil {
		t.Fatalf("logout active server: %v", err)
	}
	store, err := LoadCredentialStore(path)
	if err != nil {
		t.Fatalf("load credential store after logout: %v", err)
	}
	if len(store.Profiles) != 0 || store.Active != "" {
		t.Fatalf("expected all profiles removed, got %#v", store)
	}
}

func TestCredentialProfileValidationAndSelectionErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := SaveCredentialProfile("", CredentialProfile{AccountID: "acct", AccessToken: "token"}); err == nil {
		t.Fatal("expected missing path error")
	}
	if err := SaveCredentialProfile(path, CredentialProfile{AccountID: "acct"}); err == nil {
		t.Fatal("expected missing token error")
	}
	if err := SaveCredentialProfile(path, CredentialProfile{AccessToken: "token"}); err == nil {
		t.Fatal("expected missing account id error")
	}
	if err := SaveCredentialProfile(path, CredentialProfile{AccountID: "acct", AccessToken: "token", TokenType: "DPoP"}); err == nil || !strings.Contains(err.Error(), "must be Bearer") {
		t.Fatalf("expected legacy DPoP profile rejection, got %v", err)
	}
	expired := CredentialProfile{
		AccountID:   "acct_expired",
		APIServer:   "https://expired.example.test",
		AccessToken: "expired-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	}
	if err := SaveCredentialProfile(path, expired); err != nil {
		t.Fatalf("save expired profile: %v", err)
	}
	if _, err := LoadCredentialProfile(path, "https://expired.example.test"); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired token error, got %v", err)
	}
	if _, err := SwitchCredentialProfile(path, "https://missing.example.test", ""); err == nil || !strings.Contains(err.Error(), "no saved auth profile") {
		t.Fatalf("expected missing profile error, got %v", err)
	}
	if _, err := SwitchCredentialProfile(path, "", "missing@example.test"); err == nil || !strings.Contains(err.Error(), "no saved auth account") {
		t.Fatalf("expected missing account error, got %v", err)
	}
}

func TestCredentialStoreIgnoresLegacyDPoPKeyOnBearerProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(path, []byte(`{
  "active": "https://ama.example.test#acct_1",
  "profiles": [{
    "accountId": "acct_1",
    "apiServer": "https://ama.example.test",
    "accessToken": "token",
    "tokenType": "Bearer",
    "dpopPrivateKey": "legacy-key-must-be-ignored"
  }]
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	profile, err := LoadActiveCredentialProfile(path)
	if err != nil || profile == nil || profile.TokenType != "Bearer" {
		t.Fatalf("expected Bearer profile with ignored legacy field, profile=%#v err=%v", profile, err)
	}
	if err := SaveCredentialProfile(path, *profile); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "dpopPrivateKey") || strings.Contains(string(data), "legacy-key") {
		t.Fatalf("legacy DPoP key survived credential rewrite: %s", data)
	}
}

func TestCredentialStoreHandlesMissingEmptyAndInvalidFiles(t *testing.T) {
	if store, err := LoadCredentialStore(""); err != nil || len(store.Profiles) != 0 {
		t.Fatalf("empty path should return empty store, store=%#v err=%v", store, err)
	}
	missing := filepath.Join(t.TempDir(), "missing.json")
	if store, err := LoadCredentialStore(missing); err != nil || len(store.Profiles) != 0 {
		t.Fatalf("missing file should return empty store, store=%#v err=%v", store, err)
	}
	invalid := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(invalid, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadCredentialStore(invalid); err == nil {
		t.Fatal("expected invalid JSON error")
	}
	if _, err := LoadActiveCredentialProfile(""); err != nil {
		t.Fatalf("empty active credential path should be ignored: %v", err)
	}
	fileParent := filepath.Join(t.TempDir(), "file-parent")
	if err := os.WriteFile(fileParent, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SaveCredentialProfile(filepath.Join(fileParent, "credentials.json"), CredentialProfile{
		AccountID:   "acct_1",
		APIServer:   "https://ama.example.test",
		AccessToken: "token",
	}); err == nil {
		t.Fatal("expected save under file parent to fail")
	}
}

func TestCredentialProfileLookupAndLogoutBranches(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	alpha := CredentialProfile{
		AccountID:   "acct_alpha",
		APIServer:   "https://alpha.example.test",
		Email:       "alpha@example.test",
		AccessToken: "alpha-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	beta := CredentialProfile{
		AccountID:   "acct_beta",
		APIServer:   "https://beta.example.test",
		AccessToken: "beta-token",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	if err := SaveCredentialProfile(path, alpha); err != nil {
		t.Fatal(err)
	}
	if err := SaveCredentialProfile(path, beta); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadCredentialProfile(path, "https://alpha.example.test/")
	if err != nil {
		t.Fatalf("load alpha profile: %v", err)
	}
	if loaded == nil || loaded.AccountID != "acct_alpha" {
		t.Fatalf("unexpected alpha profile %#v", loaded)
	}
	missing, err := LoadCredentialProfile(path, "https://missing.example.test")
	if err != nil || missing != nil {
		t.Fatalf("missing profile should return nil, profile=%#v err=%v", missing, err)
	}

	if err := LogoutCredentialProfile(path, "https://beta.example.test/"); err != nil {
		t.Fatalf("logout beta profile: %v", err)
	}
	store, err := LoadCredentialStore(path)
	if err != nil {
		t.Fatalf("load store after beta logout: %v", err)
	}
	if len(store.Profiles) != 1 || store.Profiles[0].AccountID != "acct_alpha" || !strings.Contains(store.Active, "acct_alpha") {
		t.Fatalf("expected alpha to become active after beta logout, got %#v", store)
	}
	if err := LogoutCredentialProfile(path, " "); err != nil {
		t.Fatalf("logout active profile: %v", err)
	}
	store, err = LoadCredentialStore(path)
	if err != nil {
		t.Fatalf("load store after active logout: %v", err)
	}
	if len(store.Profiles) != 0 || store.Active != "" {
		t.Fatalf("expected empty store after active logout, got %#v", store)
	}

	orphanActive := filepath.Join(t.TempDir(), "orphan.json")
	if err := os.WriteFile(orphanActive, []byte(`{"active":"missing#acct","profiles":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	active, err := LoadActiveCredentialProfile(orphanActive)
	if err != nil || active != nil {
		t.Fatalf("orphan active profile should return nil, profile=%#v err=%v", active, err)
	}
	if err := LogoutCredentialProfile(orphanActive, ""); err != nil {
		t.Fatalf("logout orphan active profile should be a no-op: %v", err)
	}
}

func TestCredentialProfileUpdateBranches(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	profile := CredentialProfile{
		AccountID:    "acct_1",
		APIServer:    "https://ama.example.test",
		AccessToken:  "token-1",
		RefreshToken: "refresh-1",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	if err := SaveCredentialProfile(path, profile); err != nil {
		t.Fatal(err)
	}

	if _, err := UpdateCredentialProfile(path, "https://ama.example.test", nil); err == nil {
		t.Fatal("expected nil update function error")
	}
	if _, err := UpdateCredentialProfile(path, "https://missing.example.test", func(current CredentialProfile) (CredentialProfile, bool, error) {
		t.Fatalf("unexpected update for missing profile %#v", current)
		return current, false, nil
	}); err == nil || !strings.Contains(err.Error(), "no saved auth profile") {
		t.Fatalf("expected missing profile update error, got %v", err)
	}
	if _, err := UpdateCredentialProfile(path, "", func(current CredentialProfile) (CredentialProfile, bool, error) {
		return current, false, os.ErrPermission
	}); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected update callback error, got %v", err)
	}

	updated, err := UpdateCredentialProfile(path, "https://ama.example.test/", func(current CredentialProfile) (CredentialProfile, bool, error) {
		current.AccessToken = "token-2"
		return current, true, nil
	})
	if err != nil {
		t.Fatalf("update profile: %v", err)
	}
	if updated.AccessToken != "token-2" {
		t.Fatalf("unexpected updated profile %#v", updated)
	}
	loaded, err := LoadCredentialProfile(path, "https://ama.example.test")
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.AccessToken != "token-2" {
		t.Fatalf("expected persisted updated profile, got %#v", loaded)
	}
}

func TestCredentialProfileSelectionEdgeCases(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	sharedOne := CredentialProfile{
		AccountID:    "acct_shared_1",
		APIServer:    "https://shared.example.test",
		Email:        "one@example.test",
		Name:         "One",
		AccessToken:  "token-1",
		RefreshToken: "refresh-1",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	sharedTwo := CredentialProfile{
		AccountID:    "acct_shared_2",
		APIServer:    "https://shared.example.test/",
		Email:        "two@example.test",
		Name:         "Two",
		AccessToken:  "token-2",
		RefreshToken: "refresh-2",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	other := CredentialProfile{
		AccountID:   "acct_other",
		APIServer:   "https://other.example.test",
		AccessToken: "token-other",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}
	for _, profile := range []CredentialProfile{sharedOne, sharedTwo, other} {
		if err := SaveCredentialProfile(path, profile); err != nil {
			t.Fatalf("save profile %s: %v", profile.AccountID, err)
		}
	}

	if _, err := LoadCredentialProfile(path, "https://shared.example.test"); err == nil || !strings.Contains(err.Error(), "multiple saved accounts") {
		t.Fatalf("expected ambiguous profile error, got %v", err)
	}
	switched, err := SwitchCredentialProfile(path, "https://shared.example.test", "Two")
	if err != nil {
		t.Fatalf("switch by display name: %v", err)
	}
	if switched.AccountID != "acct_shared_2" {
		t.Fatalf("unexpected switched profile %#v", switched)
	}

	invalidExpiry := filepath.Join(t.TempDir(), "invalid-expiry.json")
	if err := os.WriteFile(invalidExpiry, []byte(`{"active":"https://ama.example.test#acct","profiles":[{"accountId":"acct","apiServer":"https://ama.example.test","accessToken":"token","expiresAt":"not-time"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadActiveCredentialProfile(invalidExpiry); err == nil {
		t.Fatal("expected invalid expiry error")
	}
}
