package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
		case "/api/v1/configz":
			_ = json.NewEncoder(w).Encode(testPublicConfig(
				"http://"+r.Host+"/issuer",
				"https://ama.example.test",
				"runner-client",
				[]string{"openid", "profile", "email", "offline_access"},
			))
		case "/issuer/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                 "http://" + r.Host + "/issuer",
				"authorization_endpoint": "http://" + r.Host + "/authorize",
				"token_endpoint":         "http://" + r.Host + "/token",
				"jwks_uri":               "http://" + r.Host + "/jwks",
			})
		case "/token":
			refreshes += 1
			if r.Header.Get("dpop") != "" {
				t.Fatal("refresh request must not include a DPoP proof")
			}
			if r.Header.Get("content-type") != "application/x-www-form-urlencoded" {
				t.Fatalf("refresh request must use form encoding, got %q", r.Header.Get("content-type"))
			}
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

func TestTokenSourceRefreshRetainsExistingRefreshTokenWhenOmitted(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/v1/configz":
			_ = json.NewEncoder(w).Encode(testPublicConfig(
				"http://"+r.Host+"/issuer",
				"",
				"runner-client",
				[]string{"openid", "profile", "email", "offline_access"},
			))
		case "/issuer/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                 "http://" + r.Host + "/issuer",
				"authorization_endpoint": "http://" + r.Host + "/authorize",
				"token_endpoint":         "http://" + r.Host + "/token",
				"jwks_uri":               "http://" + r.Host + "/jwks",
			})
		case "/token":
			if r.FormValue("resource") != server.URL {
				t.Fatalf("expected fallback resource %q, got %q", server.URL, r.FormValue("resource"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fresh-access-token",
				"token_type":   "Bearer",
				"expires_in":   3600,
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
	}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.AccessToken(context.Background()); err != nil {
		t.Fatalf("expected refresh to succeed, got %v", err)
	}
	saved, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.RefreshToken != "old-refresh-token" {
		t.Fatalf("expected existing refresh token to be retained, got %#v", saved)
	}
}

func TestTokenSourceReusesCredentialRefreshedByAnotherProcess(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Fatalf("token source should not call control plane after shared credentials are refreshed; got %s", r.URL.Path)
	}))
	defer server.Close()

	for _, tc := range []struct {
		name       string
		expiresAt  time.Time
		readToken  func(*TokenSource) (string, error)
		wantAccess string
	}{
		{
			name:      "regular access token read [spec: runners/local-credential-refresh]",
			expiresAt: time.Now().Add(-time.Minute),
			readToken: func(source *TokenSource) (string, error) {
				return source.AccessToken(context.Background())
			},
			wantAccess: "fresh-access-token",
		},
		{
			name:      "forced refresh after unauthorized response [spec: runners/local-credential-refresh]",
			expiresAt: time.Now().Add(time.Hour),
			readToken: func(source *TokenSource) (string, error) {
				return source.ForceRefresh(context.Background())
			},
			wantAccess: "fresh-access-token",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
				AccountID:    "acct_1",
				APIServer:    server.URL,
				AccessToken:  "stale-access-token",
				RefreshToken: "old-refresh-token",
				TokenType:    "Bearer",
				ExpiresAt:    tc.expiresAt.UTC().Format(time.RFC3339),
			}); err != nil {
				t.Fatal(err)
			}
			source, err := NewTokenSource(runnerconfig.Config{
				CredentialPath: credentialPath,
				APIServer:      server.URL,
			}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
				AccountID:    "acct_1",
				APIServer:    server.URL,
				AccessToken:  "fresh-access-token",
				RefreshToken: "new-refresh-token",
				TokenType:    "Bearer",
				ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			}); err != nil {
				t.Fatal(err)
			}
			token, err := tc.readToken(source)
			if err != nil {
				t.Fatalf("expected shared refreshed token, got %v", err)
			}
			if token != tc.wantAccess {
				t.Fatalf("unexpected token %q", token)
			}
		})
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

func TestNewTokenSourceWithoutSavedBearerProfileFailsClosed(t *testing.T) {
	_, err := NewTokenSource(runnerconfig.Config{
		CredentialPath: filepath.Join(t.TempDir(), "missing.json"),
		APIServer:      "https://ama.example.test",
	}, nil)
	if err == nil {
		t.Fatal("expected missing Realmroot Bearer login error")
	}
}

func TestNewTokenSourceRejectsLegacyDPoPProfile(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(credentialPath, []byte(`{
  "active": "https://ama.example.test#acct_1",
  "profiles": [{
    "accountId": "acct_1",
    "apiServer": "https://ama.example.test",
    "accessToken": "legacy-token",
    "tokenType": "DPoP",
    "dpopPrivateKey": "legacy-key"
  }]
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := NewTokenSource(runnerconfig.Config{CredentialPath: credentialPath, APIServer: "https://ama.example.test"}, nil)
	if err == nil || !strings.Contains(err.Error(), "Realmroot Bearer login") {
		t.Fatalf("expected legacy DPoP profile to require a fresh Bearer login, got %v", err)
	}
}
