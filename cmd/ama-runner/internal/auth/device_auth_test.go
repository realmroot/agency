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
	"errors"
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
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/testutil"
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
	lockRunnerCallbackPort(t)
	credentialPath := filepath.Join(t.TempDir(), "ama-runner", "credentials.json")
	fixture := newOIDCLoginFixture(t)
	defer fixture.Close()
	output := newLockedBuffer()
	result := make(chan loginResult, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
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

	authorize := waitForAuthorizationURL(t, output, done)
	assertAuthorizationURL(t, authorize, fixture.URL()+"/authorize")
	fixture.SetNonce(authorize.Query().Get("nonce"))
	notCallback := callbackURL(authorize)
	notCallback.Path = "/not-the-oauth-callback"
	if status, _ := getLoopback(t, notCallback); status != http.StatusNotFound {
		t.Fatalf("unexpected non-callback status %d", status)
	}
	callback := callbackURL(authorize)
	query := callback.Query()
	query.Set("code", "one-time-code")
	query.Set("state", authorize.Query().Get("state"))
	query.Set("iss", fixture.URL())
	callback.RawQuery = query.Encode()
	status, body := getLoopback(t, callback)
	if status != http.StatusOK || body != "Enbor Runner authentication complete. You may close this window.\n" {
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
	lockRunnerCallbackPort(t)
	fixture := newOIDCLoginFixture(t)
	defer fixture.Close()
	output := newLockedBuffer()
	result := make(chan error, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, err := LoginWithAuthorizationCode(context.Background(), OAuthClient{HTTPClient: fixture.Client()}, loginOptions(fixture, filepath.Join(t.TempDir(), "credentials.json"), output))
		result <- err
	}()
	authorize := waitForAuthorizationURL(t, output, done)
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
	lockRunnerCallbackPort(t)
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
		{name: "OAuth error without description", query: func(query url.Values, state string) {
			query.Set("state", state)
			query.Set("error", "access_denied")
		}, want: "OIDC authorization failed: access_denied"},
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
			output := newLockedBuffer()
			result := make(chan error, 1)
			done := make(chan struct{})
			go func() {
				defer close(done)
				_, err := LoginWithAuthorizationCode(context.Background(), OAuthClient{HTTPClient: fixture.Client()}, loginOptions(fixture, filepath.Join(t.TempDir(), "credentials.json"), output))
				result <- err
			}()
			authorize := waitForAuthorizationURL(t, output, done)
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
	lockRunnerCallbackPort(t)
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

	t.Run("malformed compact token", func(t *testing.T) {
		_, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, "not-a-jwt", "runner-client", "expected-nonce")
		if err == nil || !strings.Contains(err.Error(), "did not include an id token") {
			t.Fatalf("expected malformed compact token error, got %v", err)
		}
	})

	t.Run("invalid JOSE header", func(t *testing.T) {
		token := testSignedRawIDToken([]byte(`{"alg":"HS256","kid":"test-key"}`), mustJSON(base), testRSAKey())
		_, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, token, "runner-client", "expected-nonce")
		if err == nil || !strings.Contains(err.Error(), "header is invalid") {
			t.Fatalf("expected invalid JOSE header error, got %v", err)
		}
	})

	t.Run("unavailable signing key", func(t *testing.T) {
		token := testSignedRawIDToken([]byte(`{"alg":"RS256","kid":"unknown-key"}`), mustJSON(base), testRSAKey())
		_, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, token, "runner-client", "expected-nonce")
		if err == nil || !strings.Contains(err.Error(), "signing key is unavailable") {
			t.Fatalf("expected unavailable signing key error, got %v", err)
		}
	})

	t.Run("invalid signature encoding", func(t *testing.T) {
		parts := strings.Split(valid, ".")
		parts[2] = "*"
		_, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, strings.Join(parts, "."), "runner-client", "expected-nonce")
		if err == nil || !strings.Contains(err.Error(), "signature is invalid") {
			t.Fatalf("expected invalid signature encoding error, got %v", err)
		}
	})

	t.Run("malformed signed claims", func(t *testing.T) {
		token := testSignedRawIDToken([]byte(`{"alg":"RS256","kid":"test-key"}`), []byte("{"), testRSAKey())
		_, err := (OAuthClient{HTTPClient: fixture.Client()}).validateIDToken(t.Context(), metadata, token, "runner-client", "expected-nonce")
		if err == nil || !strings.Contains(err.Error(), "claims are invalid") {
			t.Fatalf("expected malformed signed claims error, got %v", err)
		}
	})
}

func TestAuthorizationCodeAndDiscoveryProtocolFailures(t *testing.T) {
	if _, err := LoginWithAuthorizationCode(t.Context(), OAuthClient{}, AuthorizationCodeLoginOptions{}); err == nil || !strings.Contains(err.Error(), "OIDC metadata") {
		t.Fatalf("expected missing published OIDC settings error, got %v", err)
	}

	t.Run("incomplete metadata", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"issuer":"issuer"}`)) }))
		defer server.Close()
		_, err := (OAuthClient{HTTPClient: server.Client()}).Discover(t.Context(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "incomplete or mismatched") {
			t.Fatalf("expected incomplete metadata error, got %v", err)
		}
	})

	t.Run("unsafe metadata endpoint", func(t *testing.T) {
		var server *httptest.Server
		server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(response).Encode(map[string]string{
				"issuer": server.URL, "authorization_endpoint": "http://identity.example.test/authorize",
				"token_endpoint": server.URL + "/token", "jwks_uri": server.URL + "/jwks",
			})
		}))
		defer server.Close()
		_, err := (OAuthClient{HTTPClient: server.Client()}).Discover(t.Context(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "unsafe endpoint") {
			t.Fatalf("expected unsafe discovery endpoint error, got %v", err)
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

func TestOAuthClientPropagatesTransportAndProviderErrors(t *testing.T) {
	t.Run("structured OAuth error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusBadRequest)
			_, _ = response.Write([]byte(`{"error":"invalid_grant","error_description":"refresh expired"}`))
		}))
		defer server.Close()

		_, err := (OAuthClient{HTTPClient: server.Client()}).RefreshToken(t.Context(), server.URL, "runner-client", "expired", "")
		var tokenErr oauthTokenError
		if !errors.As(err, &tokenErr) || tokenErr.Code != "invalid_grant" || tokenErr.Description != "refresh expired" || tokenErr.Error() != "refresh expired" {
			t.Fatalf("unexpected structured OAuth error %#v from %v", tokenErr, err)
		}
	})

	t.Run("unstructured provider status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusServiceUnavailable)
			_, _ = response.Write([]byte("provider unavailable"))
		}))
		defer server.Close()

		_, err := (OAuthClient{HTTPClient: server.Client()}).Discover(t.Context(), server.URL)
		var statusErr oidcStatusError
		if !errors.As(err, &statusErr) || statusErr.Path != "/.well-known/openid-configuration" || statusErr.Status != http.StatusServiceUnavailable {
			t.Fatalf("unexpected OIDC status error %#v from %v", statusErr, err)
		}
		if statusErr.Error() != "OIDC /.well-known/openid-configuration failed with status 503" {
			t.Fatalf("unexpected OIDC status message %q", statusErr.Error())
		}
	})

	t.Run("invalid successful JSON", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			_, _ = response.Write([]byte("{"))
		}))
		defer server.Close()
		if _, err := (OAuthClient{HTTPClient: server.Client()}).Discover(t.Context(), server.URL); err == nil {
			t.Fatal("expected malformed successful discovery response to fail")
		}
	})

	t.Run("transport error", func(t *testing.T) {
		expected := errors.New("identity provider offline")
		client := OAuthClient{HTTPClient: &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			return nil, expected
		})}}
		if _, err := client.Discover(t.Context(), "https://identity.example.test"); !errors.Is(err, expected) {
			t.Fatalf("expected transport error propagation, got %v", err)
		}
	})

	t.Run("response read error", func(t *testing.T) {
		expected := errors.New("response body interrupted")
		client := OAuthClient{HTTPClient: &http.Client{Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(failingReader{err: expected}),
				Header:     make(http.Header),
			}, nil
		})}}
		if _, err := client.Discover(t.Context(), "https://identity.example.test"); !errors.Is(err, expected) {
			t.Fatalf("expected response read error propagation, got %v", err)
		}
	})

	t.Run("default HTTP client", func(t *testing.T) {
		var server *httptest.Server
		server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(response).Encode(map[string]string{
				"issuer": server.URL, "authorization_endpoint": server.URL + "/authorize",
				"token_endpoint": server.URL + "/token", "jwks_uri": server.URL + "/jwks",
			})
		}))
		defer server.Close()
		metadata, err := (OAuthClient{}).Discover(t.Context(), server.URL)
		if err != nil || metadata.Issuer != server.URL {
			t.Fatalf("expected default HTTP client discovery, metadata=%#v err=%v", metadata, err)
		}
	})
}

func TestOIDCHelpersHandleBoundaryValues(t *testing.T) {
	if got := tokenAudiences(json.RawMessage(`{"unexpected":true}`)); got != nil {
		t.Fatalf("invalid audience shape should not produce audiences, got %#v", got)
	}
	if got := expiresAt(0); got != "" {
		t.Fatalf("non-positive expiry should be absent, got %q", got)
	}
	if got := errorDescription(tokenResponse{Error: "invalid_grant"}); got != "invalid_grant" {
		t.Fatalf("OAuth code fallback = %q", got)
	}
	if got := errorDescription(tokenResponse{}); got != "provider_error" {
		t.Fatalf("empty provider error fallback = %q", got)
	}
	if _, err := buildAuthorizationURL("http://[::1", AuthorizationCodeLoginOptions{}, "state", "verifier", "nonce"); err == nil {
		t.Fatal("expected invalid authorization endpoint to fail parsing")
	}
	var response map[string]any
	if err := (OAuthClient{}).getJSON(t.Context(), "http://identity.example.test/invalid url", &response); err == nil {
		t.Fatal("expected invalid discovery request URL to fail")
	}
	if err := (OAuthClient{}).postForm(t.Context(), "http://identity.example.test/invalid url", url.Values{}, &response); err == nil {
		t.Fatal("expected invalid token request URL to fail")
	}
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

func waitForAuthorizationURL(t *testing.T, output *lockedBuffer, loginDone <-chan struct{}) *url.URL {
	t.Helper()
	select {
	case <-output.Ready():
	case <-loginDone:
		t.Fatalf("login terminated before printing authorization URL: %s", output.String())
	}
	text := output.String()
	index := strings.Index(text, "Open: ")
	if index < 0 {
		t.Fatalf("authorization output did not contain URL: %s", text)
	}
	line := strings.TrimSpace(strings.SplitN(text[index+len("Open: "):], "\n", 2)[0])
	parsed, err := url.Parse(line)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
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
	mu        sync.Mutex
	b         bytes.Buffer
	ready     chan struct{}
	readyOnce sync.Once
}

func newLockedBuffer() *lockedBuffer {
	return &lockedBuffer{ready: make(chan struct{})}
}

func (buffer *lockedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	written, err := buffer.b.Write(data)
	buffer.readyOnce.Do(func() { close(buffer.ready) })
	return written, err
}
func (buffer *lockedBuffer) String() string {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.b.String()
}

func (buffer *lockedBuffer) Ready() <-chan struct{} {
	return buffer.ready
}

type loginResult struct {
	Result AuthorizationCodeLoginResult
	Err    error
}

func lockRunnerCallbackPort(t *testing.T) {
	t.Helper()
	release, err := testutil.AcquireRunnerCallbackTestLock(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := release(); err != nil {
			t.Errorf("release runner callback test lock: %v", err)
		}
	})
}

type failingReader struct {
	err error
}

func (reader failingReader) Read([]byte) (int, error) {
	return 0, reader.err
}

func testJWKS() map[string]any {
	key := testRSAKey().PublicKey
	return map[string]any{"keys": []map[string]string{{
		"kid": "test-key", "kty": "RSA", "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
	}}}
}

func testSignedIDToken(claims map[string]any, key *rsa.PrivateKey) string {
	return testSignedRawIDToken([]byte(`{"alg":"RS256","kid":"test-key"}`), mustJSON(claims), key)
}

func testSignedRawIDToken(headerJSON []byte, payloadJSON []byte, key *rsa.PrivateKey) string {
	header := base64.RawURLEncoding.EncodeToString(headerJSON)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	signed := header + "." + encodedPayload
	digest := sha256.Sum256([]byte(signed))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		panic(err)
	}
	return signed + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func mustJSON(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return encoded
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
