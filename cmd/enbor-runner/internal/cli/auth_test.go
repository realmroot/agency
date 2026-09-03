package cli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
	"github.com/spf13/cobra"
)

func TestRunAuthCommandsUseCredentialStore(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	saveCredential(t, credentialPath, runnerconfig.CredentialProfile{
		AccountID:   "acct_1",
		APIServer:   "https://ama.example.test",
		Email:       "one@example.test",
		Name:        "One",
		AccessToken: "token-1",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	saveCredential(t, credentialPath, runnerconfig.CredentialProfile{
		AccountID:   "acct_2",
		APIServer:   "https://ama.example.test",
		Email:       "two@example.test",
		Name:        "Two",
		AccessToken: "token-2",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	saveCredential(t, credentialPath, runnerconfig.CredentialProfile{
		AccountID:   "acct_3",
		APIServer:   "https://other.example.test",
		AccessToken: "token-3",
		TokenType:   "Bearer",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})

	var output bytes.Buffer
	if err := RunAuthStatus(&output); err != nil {
		t.Fatalf("expected status, got %v", err)
	}
	if !strings.Contains(output.String(), "https://ama.example.test acct_2 <two@example.test>") ||
		!strings.Contains(output.String(), "* https://other.example.test acct_3") {
		t.Fatalf("unexpected status output: %s", output.String())
	}

	output.Reset()
	if err := RunAuthSwitch(authSwitchTestCommand(t, "--api-server", "https://ama.example.test"), []string{"one@example.test"}, &output); err != nil {
		t.Fatalf("expected switch, got %v", err)
	}
	if !strings.Contains(output.String(), "Switched to https://ama.example.test acct_1") {
		t.Fatalf("unexpected switch output: %s", output.String())
	}

	output.Reset()
	if err := RunAuthLogout(authSwitchTestCommand(t), []string{}, &output); err != nil {
		t.Fatalf("expected logout, got %v", err)
	}
	if !strings.Contains(output.String(), "Logged out") {
		t.Fatalf("unexpected logout output: %s", output.String())
	}
	if profile, err := runnerconfig.LoadCredentialProfile(credentialPath, "https://ama.example.test"); err != nil || profile != nil {
		t.Fatalf("expected profile to be removed, profile=%#v err=%v", profile, err)
	}
	output.Reset()
	if err := RunAuthLogout(authSwitchTestCommand(t), []string{"https://other.example.test"}, &output); err != nil {
		t.Fatalf("expected explicit server logout, got %v", err)
	}
}

func TestRunAuthRefreshUpdatesActiveCredential(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	server := authRefreshServer(t)
	defer server.Close()
	saveCredential(t, credentialPath, runnerconfig.CredentialProfile{
		AccountID:    "acct_1",
		APIServer:    server.URL,
		AccessToken:  "old-token",
		RefreshToken: "refresh-token",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	})

	var output bytes.Buffer
	if err := RunAuthRefresh(context.Background(), &output); err != nil {
		t.Fatalf("expected refresh, got %v", err)
	}
	if !strings.Contains(output.String(), "Refreshed token for "+server.URL) {
		t.Fatalf("unexpected refresh output: %s", output.String())
	}
	profile, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if profile.AccessToken != "new-token" || profile.RefreshToken != "new-refresh" {
		t.Fatalf("expected refreshed token, got %#v", profile)
	}
}

func TestRunAuthLoginValidatesConfigBeforeLoopbackPKCE(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("AMA_API_SERVER", "")
	var output bytes.Buffer
	err := RunAuthLogin(context.Background(), authLoginTestCommand(t), &output)
	if err == nil || !strings.Contains(err.Error(), "Enbor API server URL is required") {
		t.Fatalf("expected api server validation error, got %v", err)
	}
}

func TestRunAuthRequiresLogin(t *testing.T) {
	t.Setenv("AMA_RUNNER_CREDENTIALS", filepath.Join(t.TempDir(), "missing.json"))
	var output bytes.Buffer
	if err := RunAuthStatus(&output); err == nil || !strings.Contains(err.Error(), "not logged in") {
		t.Fatalf("expected status login error, got %v", err)
	}
	if err := RunAuthRefresh(context.Background(), &output); err == nil || !strings.Contains(err.Error(), "not logged in") {
		t.Fatalf("expected refresh login error, got %v", err)
	}
	if err := RunAuthSwitch(authSwitchTestCommand(t), nil, &output); err == nil {
		t.Fatal("expected switch without saved profiles to fail")
	}
}

func TestRunAuthReportsCredentialStoreErrors(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	if err := os.WriteFile(credentialPath, []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := RunAuthStatus(&output); err == nil {
		t.Fatal("expected status credential load error")
	}
	if err := RunAuthLogout(authSwitchTestCommand(t), nil, &output); err == nil {
		t.Fatal("expected logout credential load error")
	}
}

func saveCredential(t *testing.T, path string, profile runnerconfig.CredentialProfile) {
	t.Helper()
	if err := runnerconfig.SaveCredentialProfile(path, profile); err != nil {
		t.Fatal(err)
	}
}

func authSwitchTestCommand(t *testing.T, args ...string) *cobra.Command {
	t.Helper()
	command := &cobra.Command{}
	RegisterGlobalFlags(command)
	RegisterAuthSwitchFlags(command)
	if err := command.ParseFlags(args); err != nil {
		t.Fatal(err)
	}
	return command
}

func authLoginTestCommand(t *testing.T, args ...string) *cobra.Command {
	t.Helper()
	command := &cobra.Command{}
	RegisterGlobalFlags(command)
	RegisterAuthLoginFlags(command)
	if err := command.ParseFlags(args); err != nil {
		t.Fatal(err)
	}
	return command
}

func authRefreshServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/v1/configz":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"version": 1,
				"service": map[string]any{
					"name":   "Enbor",
					"origin": "http://" + r.Host,
				},
				"auth": map[string]any{
					"oidc": map[string]any{
						"issuer":   "http://" + r.Host + "/issuer",
						"resource": "http://" + r.Host,
						"browser": map[string]any{
							"clientId": "browser-client",
							"scopes":   []string{"openid", "email", "profile"},
						},
						"runner": map[string]any{
							"clientId": "runner-client",
							"scopes":   []string{"openid", "profile", "email", "offline_access"},
						},
					},
				},
			})
		case "/issuer/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                 "http://" + r.Host + "/issuer",
				"authorization_endpoint": "http://" + r.Host + "/authorize",
				"token_endpoint":         "http://" + r.Host + "/token",
				"jwks_uri":               "http://" + r.Host + "/jwks",
			})
		case "/token":
			if r.FormValue("grant_type") != "refresh_token" || r.FormValue("refresh_token") != "refresh-token" {
				t.Fatalf("unexpected refresh request: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "new-token",
				"refresh_token": "new-refresh",
				"token_type":    "Bearer",
				"expires_in":    3600,
				"scope":         "openid profile email offline_access",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	return server
}

func testIDToken(subject string, email string, name string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload, err := json.Marshal(map[string]string{
		"sub":   subject,
		"email": email,
		"name":  name,
	})
	if err != nil {
		panic(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + "."
}
