package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
)

func TestTokenSourceRefreshesExpiredSavedToken(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	refreshes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/v1/health":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":         "ok",
				"name":           "Any Managed Agents",
				"runtime":        "cloudflare-workers",
				"oidcIssuer":     "http://" + r.Host + "/issuer",
				"oidcResource":   "https://ama.example.test",
				"runnerClientId": "runner-client",
				"runnerScopes":   "openid profile email offline_access",
			})
		case "/issuer/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        "http://" + r.Host + "/issuer",
				"device_authorization_endpoint": "http://" + r.Host + "/device",
				"token_endpoint":                "http://" + r.Host + "/token",
			})
		case "/token":
			refreshes += 1
			if r.FormValue("grant_type") != RefreshGrantType ||
				r.FormValue("client_id") != "runner-client" ||
				r.FormValue("refresh_token") != "old-refresh-token" ||
				r.FormValue("resource") != "https://ama.example.test" {
				t.Fatalf("unexpected refresh form: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "fresh-access-token",
				"refresh_token": "new-refresh-token",
				"token_type":    "Bearer",
				"expires_in":    3600,
				"scope":         "openid profile email offline_access",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID:    "acct_1",
		APIServer:    server.URL,
		AccessToken:  "expired-access-token",
		RefreshToken: "old-refresh-token",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(-time.Minute).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}

	source, err := NewTokenSource(runnerconfig.Config{
		CredentialPath: credentialPath,
		APIServer:      server.URL,
		Token:          "expired-access-token",
	}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	token, err := source.AccessToken(context.Background())
	if err != nil {
		t.Fatalf("expected refresh to succeed, got %v", err)
	}
	if token != "fresh-access-token" || refreshes != 1 {
		t.Fatalf("unexpected refresh result token=%q refreshes=%d", token, refreshes)
	}
	saved, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.AccessToken != "fresh-access-token" ||
		saved.RefreshToken != "new-refresh-token" {
		t.Fatalf("unexpected persisted refreshed config: %#v", saved)
	}
}

func TestTokenSourceExplicitTokenPaths(t *testing.T) {
	source := &TokenSource{Config: runnerconfig.Config{Token: " explicit-token "}}
	token, err := source.AccessToken(context.Background())
	if err != nil {
		t.Fatalf("expected explicit token, got %v", err)
	}
	if token != " explicit-token " {
		t.Fatalf("unexpected explicit token %q", token)
	}
	refreshed, err := source.ForceRefresh(context.Background())
	if err != nil {
		t.Fatalf("expected explicit force refresh to return token, got %v", err)
	}
	if refreshed != " explicit-token " {
		t.Fatalf("unexpected force refreshed token %q", refreshed)
	}
	source.Config.Token = " "
	if _, err := source.AccessToken(context.Background()); err == nil {
		t.Fatal("expected missing explicit token error")
	}
}

func TestTokenSourceSavedTokenValidationAndRefreshEligibility(t *testing.T) {
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	source := &TokenSource{saved: &runnerconfig.CredentialProfile{AccessToken: "saved-token", ExpiresAt: future}}
	token, err := source.AccessToken(context.Background())
	if err != nil {
		t.Fatalf("expected saved token, got %v", err)
	}
	if token != "saved-token" {
		t.Fatalf("unexpected saved token %q", token)
	}
	if source.CanRefresh() {
		t.Fatal("saved token without refresh token should not be refreshable")
	}

	source.saved = &runnerconfig.CredentialProfile{ExpiresAt: future}
	if _, err := source.AccessToken(context.Background()); err == nil {
		t.Fatal("expected missing saved access token error")
	}
	source.saved = &runnerconfig.CredentialProfile{AccessToken: "expired-token", ExpiresAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)}
	if _, err := source.ForceRefresh(context.Background()); err == nil {
		t.Fatal("expected force refresh without refresh token to fail")
	}
	source.saved.RefreshToken = "refresh-token"
	if !source.CanRefresh() {
		t.Fatal("saved refresh token should be refreshable")
	}
}

func TestTokenSourceNeedsRefresh(t *testing.T) {
	source := &TokenSource{}
	cases := []struct {
		name   string
		config runnerconfig.CredentialProfile
		want   bool
	}{
		{name: "missing access token", config: runnerconfig.CredentialProfile{}, want: true},
		{name: "no expiry", config: runnerconfig.CredentialProfile{AccessToken: "token"}, want: false},
		{name: "invalid expiry", config: runnerconfig.CredentialProfile{AccessToken: "token", ExpiresAt: "not-time"}, want: true},
		{name: "near expiry", config: runnerconfig.CredentialProfile{AccessToken: "token", ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339)}, want: true},
		{name: "valid", config: runnerconfig.CredentialProfile{AccessToken: "token", ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339)}, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := source.needsRefresh(tc.config); got != tc.want {
				t.Fatalf("needsRefresh=%v, want %v", got, tc.want)
			}
		})
	}
}

func TestNewTokenSourceReturnsCredentialLoadErrors(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(credentialPath, []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewTokenSource(runnerconfig.Config{CredentialPath: credentialPath, APIServer: "https://ama.example.test"}, nil); err == nil {
		t.Fatal("expected invalid credential file error")
	}
}
