package auth

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
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
)

const testRunnerScopes = "openid profile email offline_access runners:register runners:heartbeat runners:work runners:lease"

var testRSAKey = sync.OnceValue(func() *rsa.PrivateKey {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	return key
})

func TestLoginWithAuthorizationCodeLoopbackPKCE(t *testing.T) {
	// [spec: runners/auth-binding]
	credentialPath := filepath.Join(t.TempDir(), "ama-runner", "credentials.json")
	fixture := newOIDCLoginFixture(t)
	defer fixture.Close()
	output := &lockedBuffer{}
	result := make(chan loginResult, 1)
	go func() {
		login, err := LoginWithAuthorizationCode(context.Background(), OAuthClient{HTTPClient: fixture.Client()}, AuthorizationCodeLoginOptions{
			APIServer:      "https://ama.example.test/",
			Issuer:         fixture.URL(),
			Resource:       "https://ama.example.test/api/",
			ClientID:       "runner-client",
			Scopes:         testRunnerScopes,
			CredentialPath: credentialPath,
			Output:         output,
		})
		result <- loginResult{Result: login, Err: err}
	}()

	authorize := waitForAuthorizationURL(t, output)
	assertAuthorizationURL(t, authorize, fixture.URL()+"/authorize")
	fixture.SetNonce(authorize.Query().Get("nonce"))
	callback := callbackURL(authorize)
	query := callback.Query()
	query.Set("code", "one-time-code")
	query.Set("state", authorize.Query().Get("state"))
	query.Set("iss", fixture.URL())
	callback.RawQuery = query.Encode()
	status, body := getLoopback(t, callback)
	if status != http.StatusOK || body != "AMA runner authentication complete. You may close this window.\n" {
		t.Fatalf("unexpected callback response status=%d body=%q", status, body)
	}

	completed := <-result
	if completed.Err != nil {
		t.Fatalf("expected loopback login success, got %v", completed.Err)
	}
	if completed.Result.APIServer != "https://ama.example.test" || completed.Result.CredentialPath != credentialPath {
		t.Fatalf("unexpected login result %#v", completed.Result)
	}
	waitForCallbackPortRelease(t)

	form, authorization := fixture.TokenRequest()
	wantForm := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {"one-time-code"},
		"client_id":     {"runner-client"},
		"redirect_uri":  {"http://127.0.0.1:49174/oauth/callback"},
		"code_verifier": {form.Get("code_verifier")},
		"resource":      {"https://ama.example.test/api"},
	}
	if form.Encode() != wantForm.Encode() {
		t.Fatalf("unexpected token exchange form: %s", form.Encode())
	}
	if form.Get("client_secret") != "" || authorization != "" {
		t.Fatalf("public client leaked a secret: form=%s authorization=%q", form.Encode(), authorization)
	}
	challenge := sha256.Sum256([]byte(form.Get("code_verifier")))
	if authorize.Query().Get("code_challenge") != base64.RawURLEncoding.EncodeToString(challenge[:]) {
		t.Fatal("authorization challenge does not match token exchange verifier")
	}

	profile, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if profile == nil || profile.AccountID != "user_1" || profile.AccessToken != "runner-access-token" ||
		profile.RefreshToken != "runner-refresh-token" || profile.TokenType != "Bearer" || profile.Scope != testRunnerScopes {
		t.Fatalf("unexpected saved credential profile %#v", profile)
	}
	credentialData, err := os.ReadFile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(credentialData, []byte("runner-access-token")) {
		t.Fatalf("expected Bearer credential to be persisted, got %s", credentialData)
	}
	if strings.Contains(output.String(), "runner-access-token") || strings.Contains(output.String(), "runner-refresh-token") {
		t.Fatalf("login output leaked credential material: %s", output.String())
	}
}

func TestLoopbackWrongStateDoesNotTerminateLogin(t *testing.T) {
	fixture := newOIDCLoginFixture(t)
	defer fixture.Close()
	output := &lockedBuffer{}
	result := make(chan error, 1)
	go func() {
		_, err := LoginWithAuthorizationCode(context.Background(), OAuthClient{HTTPClient: fixture.Client()}, loginOptions(fixture, filepath.Join(t.TempDir(), "credentials.json"), output))
		result <- err
	}()
	authorize := waitForAuthorizationURL(t, output)
	fixture.SetNonce(authorize.Query().Get("nonce"))

	wrong := callbackURL(authorize)
	wrongQuery := wrong.Query()
	wrongQuery.Set("code", "attacker-code")
	wrongQuery.Set("state", authorize.Query().Get("state")+"-wrong")
	wrong.RawQuery = wrongQuery.Encode()
	status, body := getLoopback(t, wrong)
	if status != http.StatusBadRequest || !strings.Contains(body, "Invalid OAuth state") {
		t.Fatalf("unexpected wrong-state response status=%d body=%q", status, body)
	}
	select {
	case err := <-result:
		t.Fatalf("wrong state terminated login: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	if fixture.TokenCalls() != 0 {
		t.Fatal("wrong-state callback reached token exchange")
	}

	valid := callbackURL(authorize)
	validQuery := valid.Query()
	validQuery.Set("code", "valid-code")
	validQuery.Set("state", authorize.Query().Get("state"))
	valid.RawQuery = validQuery.Encode()
	status, _ = getLoopback(t, valid)
	if status != http.StatusOK {
		t.Fatalf("matching callback failed with status %d", status)
	}
	if err := <-result; err != nil {
		t.Fatalf("matching callback did not complete login: %v", err)
	}
	waitForCallbackPortRelease(t)
	if fixture.TokenCalls() != 1 {
		t.Fatalf("expected one exchange after valid callback, got %d", fixture.TokenCalls())
	}
}

func TestLoopbackCallbackErrorsFailClosed(t *testing.T) {
	cases := []struct {
		name  string
		query func(url.Values, string)
		want  string
	}{
		{name: "OAuth error", query: func(query url.Values, state string) {
			query.Set("state", state)
			query.Set("error", "access_denied")
			query.Set("error_description", "operator denied access")
		}, want: "OIDC authorization failed: access_denied: operator denied access"},
		{name: "missing code", query: func(query url.Values, state string) { query.Set("state", state) }, want: "OIDC callback did not include an authorization code"},
		{name: "issuer mismatch", query: func(query url.Values, state string) {
			query.Set("state", state)
			query.Set("code", "must-not-exchange")
			query.Set("iss", "https://other.realmroot.test")
		}, want: "OIDC callback issuer is invalid"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newOIDCLoginFixture(t)
			defer fixture.Close()
			output := &lockedBuffer{}
			result := make(chan error, 1)
			go func() {
				_, err := LoginWithAuthorizationCode(context.Background(), OAuthClient{HTTPClient: fixture.Client()}, loginOptions(fixture, filepath.Join(t.TempDir(), "credentials.json"), output))
				result <- err
			}()
			authorize := waitForAuthorizationURL(t, output)
			callback := callbackURL(authorize)
			query := callback.Query()
			testCase.query(query, authorize.Query().Get("state"))
			callback.RawQuery = query.Encode()
			status, _ := getLoopback(t, callback)
			if status != http.StatusBadRequest {
				t.Fatalf("expected callback 400, got %d", status)
			}
			if err := <-result; err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("expected %q, got %v", testCase.want, err)
			}
			waitForCallbackPortRelease(t)
			if fixture.TokenCalls() != 0 {
				t.Fatal("invalid callback reached token exchange")
			}
		})
	}
}

func TestLoopbackPortOccupiedTimeoutAndRelease(t *testing.T) {
	t.Run("occupied", func(t *testing.T) {
		fixture := newOIDCLoginFixture(t)
		defer fixture.Close()
		listener, err := net.Listen("tcp", "127.0.0.1:49174")
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		_, err = LoginWithAuthorizationCode(t.Context(), OAuthClient{HTTPClient: fixture.Client()}, loginOptions(fixture, filepath.Join(t.TempDir(), "credentials.json"), io.Discard))
		if err == nil || !strings.Contains(err.Error(), "start Realmroot callback listener") {
			t.Fatalf("expected occupied callback port error, got %v", err)
		}
	})

	t.Run("caller timeout releases listener", func(t *testing.T) {
		fixture := newOIDCLoginFixture(t)
		defer fixture.Close()
		ctx, cancel := context.WithTimeout(t.Context(), 40*time.Millisecond)
		defer cancel()
		_, err := LoginWithAuthorizationCode(ctx, OAuthClient{HTTPClient: fixture.Client()}, loginOptions(fixture, filepath.Join(t.TempDir(), "credentials.json"), io.Discard))
		if err == nil || !strings.Contains(err.Error(), "deadline exceeded") {
			t.Fatalf("expected context timeout, got %v", err)
		}
		waitForCallbackPortRelease(t)
	})
}

func TestValidateIDTokenRequiresNonceSignatureIssuerAndAudience(t *testing.T) {
	fixture := newOIDCLoginFixture(t)
	defer fixture.Close()
	metadata := oidcMetadata{Issuer: fixture.URL(), JWKSURI: fixture.URL() + "/jwks"}
	now := time.Now().Unix()
	base := map[string]any{
		"iss": metadata.Issuer, "aud": "runner-client", "sub": "user_1", "nonce": "expected-nonce",
		"email": "runner@example.test", "name": "Runner", "iat": now, "exp": now + 300,
	}
	valid := testSignedIDToken(base, testRSAKey())
	identity, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, valid, "runner-client", "expected-nonce")
	if err != nil || identity.Subject != "user_1" {
		t.Fatalf("expected valid signed identity, identity=%#v err=%v", identity, err)
	}
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		claims map[string]any
		key    *rsa.PrivateKey
		want   string
	}{
		{name: "nonce", claims: cloneClaims(base, "nonce", "wrong"), key: testRSAKey(), want: "claims are invalid"},
		{name: "issuer", claims: cloneClaims(base, "iss", "https://other.example.test"), key: testRSAKey(), want: "claims are invalid"},
		{name: "audience", claims: cloneClaims(base, "aud", "other-client"), key: testRSAKey(), want: "claims are invalid"},
		{name: "signature", claims: base, key: otherKey, want: "signature is invalid"},
		{name: "authorized party", claims: cloneClaims(base, "aud", []string{"runner-client", "other-client"}, "azp", "other-client"), key: testRSAKey(), want: "authorized party is invalid"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, testSignedIDToken(testCase.claims, testCase.key), "runner-client", "expected-nonce")
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("expected %q, got %v", testCase.want, err)
			}
		})
	}
}

func TestAuthorizationCodeAndDiscoveryProtocolFailures(t *testing.T) {
	t.Run("incomplete metadata", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"issuer":"issuer"}`)) }))
		defer server.Close()
		_, err := (OAuthClient{HTTPClient: server.Client()}).Discover(t.Context(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "incomplete or mismatched") {
			t.Fatalf("expected incomplete metadata error, got %v", err)
		}
	})

	t.Run("token response validation", func(t *testing.T) {
		for _, testCase := range []struct{ body, want string }{
			{body: `{"token_type":"Bearer"}`, want: "did not include an access token"},
			{body: `{"access_token":"token","token_type":"DPoP"}`, want: "did not issue a Bearer token"},
		} {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(testCase.body)) }))
			_, err := (OAuthClient{HTTPClient: server.Client()}).ExchangeAuthorizationCode(t.Context(), server.URL, "runner", "code", "verifier", "")
			server.Close()
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("expected %q, got %v", testCase.want, err)
			}
		}
	})
}

func TestRefreshTokenRejectsProtocolFailures(t *testing.T) {
	for _, testCase := range []struct{ name, body, want string }{
		{name: "missing access token", body: `{"token_type":"Bearer"}`, want: "did not include an access token"},
		{name: "wrong token type", body: `{"access_token":"fresh","token_type":"DPoP"}`, want: "did not issue a Bearer token"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(testCase.body)) }))
			defer server.Close()
			_, err := (OAuthClient{HTTPClient: server.Client()}).RefreshToken(t.Context(), server.URL, "runner", "refresh", "")
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("expected %q, got %v", testCase.want, err)
			}
		})
	}
}

func TestRefreshTokenValidationAndDefaults(t *testing.T) {
	if _, err := (OAuthClient{}).RefreshToken(t.Context(), "https://issuer.example.test/token", "runner-client", " ", ""); err == nil {
		t.Fatal("expected missing refresh token error")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.FormValue("grant_type") != "refresh_token" || request.FormValue("refresh_token") != "refresh" ||
			request.FormValue("client_id") != "runner-client" || request.FormValue("resource") != "https://ama.example.test" {
			t.Fatalf("unexpected refresh form: %s", request.Form.Encode())
		}
		_, _ = w.Write([]byte(`{"access_token":"fresh","refresh_token":"rotated","token_type":"Bearer"}`))
	}))
	defer server.Close()
	token, err := (OAuthClient{HTTPClient: server.Client()}).RefreshToken(t.Context(), server.URL, "runner-client", "refresh", "https://ama.example.test/")
	if err != nil || token.AccessToken != "fresh" || token.RefreshToken != "rotated" {
		t.Fatalf("expected refresh success, token=%#v err=%v", token, err)
	}
}

func TestLoginCommandAndCredentialValidation(t *testing.T) {
	if _, err := ValidateLoginCommand(LoginCommand{}); err == nil || !strings.Contains(err.Error(), "URL is required") {
		t.Fatalf("expected missing API server error, got %v", err)
	}
	command, err := ValidateLoginCommand(LoginCommand{APIServer: "https://ama.example.test", CredentialPath: "/tmp/credentials.json"})
	if err != nil || command.APIServer != "https://ama.example.test" {
		t.Fatalf("unexpected validated command %#v err=%v", command, err)
	}
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_1", APIServer: "https://ama.example.test", AccessToken: "expired", TokenType: "Bearer",
		ExpiresAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := runnerconfig.LoadActiveCredentialProfile(credentialPath); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired profile error, got %v", err)
	}
}

type oidcLoginFixture struct {
	t      *testing.T
	server *httptest.Server
	mu     sync.Mutex
	nonce  string
	forms  []url.Values
	auth   []string
}

func newOIDCLoginFixture(t *testing.T) *oidcLoginFixture {
	t.Helper()
	fixture := &oidcLoginFixture{t: t}
	fixture.server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(response).Encode(map[string]string{
				"issuer": fixture.server.URL, "authorization_endpoint": fixture.server.URL + "/authorize",
				"token_endpoint": fixture.server.URL + "/token", "jwks_uri": fixture.server.URL + "/jwks",
			})
		case "/jwks":
			_ = json.NewEncoder(response).Encode(testJWKS())
		case "/token":
			if err := request.ParseForm(); err != nil {
				t.Errorf("parse token form: %v", err)
			}
			fixture.mu.Lock()
			fixture.forms = append(fixture.forms, request.Form)
			fixture.auth = append(fixture.auth, request.Header.Get("authorization"))
			nonce := fixture.nonce
			fixture.mu.Unlock()
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "runner-access-token", "refresh_token": "runner-refresh-token", "token_type": "Bearer",
				"expires_in": 3600, "scope": testRunnerScopes,
				"id_token": testSignedIDToken(map[string]any{
					"iss": fixture.server.URL, "aud": "runner-client", "sub": "user_1", "email": "runner@example.test",
					"name": "Runner User", "nonce": nonce, "iat": time.Now().Unix(), "exp": time.Now().Add(5 * time.Minute).Unix(),
				}, testRSAKey()),
			})
		default:
			http.NotFound(response, request)
		}
	}))
	return fixture
}

func (fixture *oidcLoginFixture) URL() string          { return fixture.server.URL }
func (fixture *oidcLoginFixture) Client() *http.Client { return fixture.server.Client() }
func (fixture *oidcLoginFixture) Close()               { fixture.server.Close() }
func (fixture *oidcLoginFixture) SetNonce(nonce string) {
	fixture.mu.Lock()
	fixture.nonce = nonce
	fixture.mu.Unlock()
}
func (fixture *oidcLoginFixture) TokenCalls() int {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	return len(fixture.forms)
}
func (fixture *oidcLoginFixture) TokenRequest() (url.Values, string) {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if len(fixture.forms) != 1 {
		fixture.t.Fatalf("expected one token request, got %d", len(fixture.forms))
	}
	return fixture.forms[0], fixture.auth[0]
}

func loginOptions(fixture *oidcLoginFixture, credentialPath string, output io.Writer) AuthorizationCodeLoginOptions {
	return AuthorizationCodeLoginOptions{
		APIServer: "https://ama.example.test", Issuer: fixture.URL(), Resource: "https://ama.example.test/api",
		ClientID: "runner-client", Scopes: testRunnerScopes, CredentialPath: credentialPath, Output: output,
	}
}

func assertAuthorizationURL(t *testing.T, authorize *url.URL, endpoint string) {
	t.Helper()
	if authorize.Scheme+"://"+authorize.Host+authorize.Path != endpoint {
		t.Fatalf("unexpected authorization endpoint %s", authorize)
	}
	query := authorize.Query()
	if query.Get("response_type") != "code" || query.Get("client_id") != "runner-client" ||
		query.Get("redirect_uri") != "http://127.0.0.1:49174/oauth/callback" || query.Get("resource") != "https://ama.example.test/api" ||
		query.Get("scope") != testRunnerScopes || query.Get("code_challenge_method") != "S256" {
		t.Fatalf("unexpected authorization query %s", query.Encode())
	}
	for _, name := range []string{"state", "nonce", "code_challenge"} {
		if value := query.Get(name); len(value) != 43 {
			t.Fatalf("expected 43-character %s, got %q", name, value)
		}
	}
}

func waitForAuthorizationURL(t *testing.T, output *lockedBuffer) *url.URL {
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
	t.Fatalf("authorization URL was not printed: %s", output.String())
	return nil
}

func callbackURL(authorize *url.URL) *url.URL {
	callback, _ := url.Parse(authorize.Query().Get("redirect_uri"))
	return callback
}

func getLoopback(t *testing.T, endpoint *url.URL) (int, string) {
	t.Helper()
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
	response, err := client.Get(endpoint.String())
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, string(body)
}

func waitForCallbackPortRelease(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		listener, err := net.Listen("tcp", "127.0.0.1:49174")
		if err == nil {
			_ = listener.Close()
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("callback listener did not release port 49174")
}

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (buffer *lockedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.b.Write(data)
}
func (buffer *lockedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.b.String()
}

type loginResult struct {
	Result AuthorizationCodeLoginResult
	Err    error
}

func testJWKS() map[string]any {
	key := testRSAKey().PublicKey
	return map[string]any{"keys": []map[string]string{{
		"kid": "test-key", "kty": "RSA", "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
	}}}
}

func testSignedIDToken(claims map[string]any, key *rsa.PrivateKey) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"test-key"}`))
	payload, err := json.Marshal(claims)
	if err != nil {
		panic(err)
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signed := header + "." + encodedPayload
	digest := sha256.Sum256([]byte(signed))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		panic(err)
	}
	return signed + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func cloneClaims(source map[string]any, replacements ...any) map[string]any {
	clone := make(map[string]any, len(source)+len(replacements)/2)
	for key, value := range source {
		clone[key] = value
	}
	for index := 0; index < len(replacements); index += 2 {
		clone[replacements[index].(string)] = replacements[index+1]
	}
	return clone
}
