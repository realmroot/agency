package cmd

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
)

func TestRunFailsOnInvalidConfig(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_1", APIServer: "://bad", AccessToken: "e2e-runner:test",
		TokenType: "Bearer",
	}); err != nil {
		t.Fatal(err)
	}
	err := execute(context.Background(), []string{"--api-server", "://bad"}, testBuild(), nil, nil)
	if err == nil {
		t.Fatal("expected invalid config error")
	}
	if !strings.Contains(err.Error(), "absolute URL") {
		t.Fatalf("unexpected error %v", err)
	}
}

func TestRunVersionPrintsBuildMetadata(t *testing.T) {
	var output bytes.Buffer
	err := execute(context.Background(), []string{"version", "--json"}, testBuild(), &output, nil)
	if err != nil {
		t.Fatalf("expected version output, got %v", err)
	}
	if !strings.Contains(output.String(), `"name":"ama-runner"`) || !strings.Contains(output.String(), `"version":"`) {
		t.Fatalf("unexpected version output: %s", output.String())
	}
}

func TestRunRootVersionIgnoresRunnerEnvironmentValidation(t *testing.T) {
	t.Setenv("AMA_RUNNER_LEASE_SECONDS", "soon")
	var output bytes.Buffer
	err := execute(context.Background(), []string{"--version"}, testBuild(), &output, nil)
	if err != nil {
		t.Fatalf("expected version output, got %v", err)
	}
	if !strings.Contains(output.String(), "ama-runner") {
		t.Fatalf("unexpected version output: %s", output.String())
	}
}

func TestRunWrapperExecutesVersionCommand(t *testing.T) {
	if err := Run([]string{"version"}, testBuild()); err != nil {
		t.Fatalf("expected Run wrapper to execute version command, got %v", err)
	}
}

func TestRootCommandHelpAndArgumentValidation(t *testing.T) {
	var output bytes.Buffer
	if err := execute(context.Background(), []string{"auth", "logout", "one", "two"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected auth logout argument validation error")
	}
	if err := execute(context.Background(), []string{"auth", "refresh", "extra"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected auth refresh argument validation error")
	}
	if err := execute(context.Background(), []string{"auth", "status", "extra"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected auth status argument validation error")
	}
	if err := execute(context.Background(), []string{"auth", "switch", "one", "two"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected auth switch argument validation error")
	}
	if err := execute(context.Background(), []string{"config", "get"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected config get argument validation error")
	}
	if err := execute(context.Background(), []string{"config", "list", "extra"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected config list argument validation error")
	}
	if err := execute(context.Background(), []string{"config", "set", "only-key"}, testBuild(), &output, nil); err == nil {
		t.Fatal("expected config set argument validation error")
	}
}

func TestWriterOrDiscard(t *testing.T) {
	var output bytes.Buffer
	if writerOrDiscard(&output) != &output {
		t.Fatal("expected non-nil writer to pass through")
	}
	if writerOrDiscard(nil) == nil {
		t.Fatal("expected nil writer to become io.Discard")
	}
}

func TestRunLoginCompletesLoopbackPKCEAndStoresToken(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	output := &rootLockedBuffer{}
	var nonceMu sync.Mutex
	loginNonce := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/api/v1/configz":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"version": 1,
				"service": map[string]any{
					"name":   "Any Managed Agents",
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
		case "/jwks":
			_ = json.NewEncoder(w).Encode(rootTestJWKS())
		case "/token":
			if r.FormValue("grant_type") != "authorization_code" || r.FormValue("code") != "root-login-code" ||
				r.FormValue("redirect_uri") != "http://127.0.0.1:49174/oauth/callback" || r.FormValue("client_id") != "runner-client" ||
				r.FormValue("code_verifier") == "" || r.FormValue("resource") != "http://"+r.Host {
				t.Fatalf("unexpected root login token exchange: %s", r.Form.Encode())
			}
			if r.FormValue("client_secret") != "" || r.Header.Get("authorization") != "" {
				t.Fatal("public root login sent a client secret")
			}
			nonceMu.Lock()
			nonce := loginNonce
			nonceMu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "login-access-token",
				"refresh_token": "login-refresh-token",
				"id_token":      testIDToken("http://"+r.Host+"/issuer", "runner-client", "user_1", "runner@example.test", "Runner User", nonce),
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	errCh := make(chan error, 1)
	go func() {
		errCh <- execute(context.Background(), []string{"auth", "login", "--api-server", server.URL}, testBuild(), output, nil)
	}()
	authorize := waitForRootAuthorizationURL(t, output)
	if authorize.Query().Get("redirect_uri") != "http://127.0.0.1:49174/oauth/callback" || authorize.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("unexpected root login authorize URL %s", authorize)
	}
	nonceMu.Lock()
	loginNonce = authorize.Query().Get("nonce")
	nonceMu.Unlock()
	callback, _ := url.Parse(authorize.Query().Get("redirect_uri"))
	query := callback.Query()
	query.Set("code", "root-login-code")
	query.Set("state", authorize.Query().Get("state"))
	callback.RawQuery = query.Encode()
	response, callbackErr := (&http.Client{Transport: &http.Transport{DisableKeepAlives: true}}).Get(callback.String())
	if callbackErr != nil {
		t.Fatal(callbackErr)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected root login callback status %d", response.StatusCode)
	}
	err := <-errCh
	if err != nil {
		t.Fatalf("expected login to succeed, got %v", err)
	}
	if !strings.Contains(output.String(), "authenticated") || strings.Contains(output.String(), "login-access-token") {
		t.Fatalf("unexpected login output: %s", output.String())
	}
	data, err := os.ReadFile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "login-access-token") || !strings.Contains(string(data), server.URL) {
		t.Fatalf("expected saved credentials, got %s", string(data))
	}
}

func TestRunConfigSetUsesRunnerConfigEnvironmentPath(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runner.json")
	t.Setenv("AMA_RUNNER_CONFIG", configPath)
	var output bytes.Buffer

	err := execute(context.Background(), []string{"config", "set", "environmentId", "env_1"}, testBuild(), &output, nil)
	if err != nil {
		t.Fatalf("expected config set to succeed, got %v", err)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"environmentId": "env_1"`) {
		t.Fatalf("expected config to be written to AMA_RUNNER_CONFIG path, got %s", string(data))
	}
	output.Reset()
	err = execute(context.Background(), []string{"config", "get", "environmentId"}, testBuild(), &output, nil)
	if err != nil {
		t.Fatalf("expected config get to succeed, got %v", err)
	}
	if strings.TrimSpace(output.String()) != "env_1" {
		t.Fatalf("unexpected config get output %q", output.String())
	}
	output.Reset()
	err = execute(context.Background(), []string{"config", "list"}, testBuild(), &output, nil)
	if err != nil {
		t.Fatalf("expected config list to succeed, got %v", err)
	}
	if !strings.Contains(output.String(), "environmentId=env_1") {
		t.Fatalf("unexpected config list output %q", output.String())
	}
}

func TestRunAuthStatusCommand(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	data := `{
  "active": "https://ama.example.test#acct_1",
  "profiles": [{
    "accountId": "acct_1",
    "apiServer": "https://ama.example.test",
    "accessToken": "token",
    "tokenType": "Bearer"
  }]
}`
	if err := os.WriteFile(credentialPath, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := execute(context.Background(), []string{"auth", "status"}, testBuild(), &output, nil); err != nil {
		t.Fatalf("expected auth status command, got %v", err)
	}
	if !strings.Contains(output.String(), "* https://ama.example.test acct_1") {
		t.Fatalf("unexpected auth status output %q", output.String())
	}
}

func TestRunWithContextWiresSDKDaemonAndStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	heartbeatCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/configz":
			_, _ = w.Write([]byte(`{"version":1,"service":{"name":"Any Managed Agents","origin":"https://ama.example.test"},"auth":{"oidc":{"issuer":"https://issuer.example.test","resource":"https://ama.example.test","browser":{"clientId":"browser-client","scopes":["openid","email","profile"]},"runner":{"clientId":"runner-client","scopes":["openid","profile","email","offline_access"]}}}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/runners":
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"runner_1","name":"runner","runtimes":[],"state":"offline","currentLoad":0,"maxConcurrent":1}`))
		case r.Method == http.MethodPut && r.URL.Path == "/api/v1/runners/runner_1/heartbeat":
			heartbeatCount += 1
			if heartbeatCount == 1 {
				go func() {
					time.Sleep(time.Millisecond)
					cancel()
				}()
			}
			_, _ = w.Write([]byte(`{"runnerId":"runner_1","state":"active","currentLoad":0,"runtimeUsage":[],"runtimes":[],"lastHeartbeatAt":null}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/work-items":
			_, _ = w.Write([]byte(`{"data":[],"pagination":{"limit":50,"hasMore":false,"nextCursor":null}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/leases":
			_, _ = w.Write([]byte(`{"data":[],"pagination":{"limit":100,"hasMore":false,"nextCursor":null}}`))
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/channel"):
			if got := r.Header.Get("authorization"); got != "Bearer e2e-runner:root-test" || r.Header.Get("dpop") != "" {
				t.Fatalf("expected runner channel authorization header, got %q", got)
			}
			// The relay hub dials the runner pool channel via WebSocket upgrade.
			// A non-upgrade response causes the hub to log a warning and retry
			// after its reconnect delay, which is fine for this integration test.
			w.WriteHeader(http.StatusBadRequest)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	defer server.Close()

	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_1", APIServer: server.URL, AccessToken: "e2e-runner:root-test",
		TokenType: "Bearer",
	}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AMA_API_SERVER", server.URL)
	t.Setenv("AMA_RUNNER_CREDENTIALS", credentialPath)
	t.Setenv("AMA_ENVIRONMENT_ID", "env_1")
	t.Setenv("AMA_RUNNER_ALLOW_UNSAFE_PROCESS", "true")
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	err := execute(ctx, nil, testBuild(), nil, nil)
	if err == nil || !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if heartbeatCount < 2 {
		t.Fatalf("expected active and offline heartbeats, got %d", heartbeatCount)
	}
}

func testBuild() version.Info {
	return version.Info{}
}

var rootTestRSAKey = func() *rsa.PrivateKey {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	return key
}()

func rootTestJWKS() map[string]any {
	return map[string]any{"keys": []map[string]string{{
		"kid": "root-test-key", "kty": "RSA", "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(rootTestRSAKey.PublicKey.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
	}}}
}

func testIDToken(issuer string, audience string, subject string, email string, name string, nonce string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"root-test-key"}`))
	now := time.Now().Unix()
	payload, err := json.Marshal(map[string]any{
		"iss": issuer, "aud": audience, "sub": subject, "email": email, "name": name,
		"nonce": nonce, "iat": now, "exp": now + 300,
	})
	if err != nil {
		panic(err)
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signed := header + "." + encodedPayload
	digest := sha256.Sum256([]byte(signed))
	signature, err := rsa.SignPKCS1v15(rand.Reader, rootTestRSAKey, crypto.SHA256, digest[:])
	if err != nil {
		panic(err)
	}
	return signed + "." + base64.RawURLEncoding.EncodeToString(signature)
}

type rootLockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (buffer *rootLockedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.b.Write(data)
}

func (buffer *rootLockedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.b.String()
}

func waitForRootAuthorizationURL(t *testing.T, output *rootLockedBuffer) *url.URL {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		text := output.String()
		if index := strings.Index(text, "Open: "); index >= 0 {
			line := strings.TrimSpace(strings.SplitN(text[index+len("Open: "):], "\n", 2)[0])
			parsed, err := url.Parse(line)
			if err != nil {
				t.Fatal(err)
			}
			return parsed
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("root login did not print authorize URL: %s", output.String())
	return nil
}
