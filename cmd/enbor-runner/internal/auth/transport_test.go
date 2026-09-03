package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
)

func TestAuthTransportRefreshesAndRetriesUnauthorizedRequest(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	secureRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		switch r.URL.Path {
		case "/secure":
			secureRequests += 1
			if r.Header.Get("authorization") == "Bearer stale-access-token" {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":{"message":"expired"}}`))
				return
			}
			if r.Header.Get("authorization") != "Bearer fresh-access-token" {
				t.Fatalf("unexpected authorization header: %s", r.Header.Get("authorization"))
			}
			if r.Header.Get("dpop") != "" {
				t.Fatal("runner transport must not send a DPoP proof header")
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/api/v1/configz":
			_ = json.NewEncoder(w).Encode(testPublicConfig(
				"http://"+r.Host+"/issuer",
				"http://"+r.Host,
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
		AccessToken:  "stale-access-token",
		RefreshToken: "refresh-token",
		TokenType:    "Bearer",
		ExpiresAt:    time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
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
	client := &http.Client{Transport: AuthTransport{Base: http.DefaultTransport, Tokens: source}}
	res, err := client.Post(server.URL+"/secure", "application/json", strings.NewReader(`{"ping":true}`))
	if err != nil {
		t.Fatalf("expected retry request to succeed, got %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || secureRequests != 2 {
		t.Fatalf("expected one unauthorized request and one retry, status=%d requests=%d", res.StatusCode, secureRequests)
	}
}

func TestAuthTransportPassesThroughWithoutTokenSource(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "" {
			t.Fatalf("expected no authorization header, got %q", r.Header.Get("authorization"))
		}
		_, _ = w.Write([]byte(`ok`))
	}))
	defer server.Close()
	client := &http.Client{Transport: AuthTransport{Base: http.DefaultTransport}}
	res, err := client.Get(server.URL)
	if err != nil {
		t.Fatalf("expected request success, got %v", err)
	}
	_ = res.Body.Close()
}

func TestAuthTransportReturnsBaseErrors(t *testing.T) {
	expected := errors.New("transport failed")
	transport := AuthTransport{Base: roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, expected
	})}
	request, err := http.NewRequest(http.MethodGet, "https://ama.example.test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := transport.RoundTrip(request); !errors.Is(err, expected) {
		t.Fatalf("expected base transport error, got %v", err)
	}
}

func TestAuthTransportDoesNotRetryUnauthorizedWithoutRefreshToken(t *testing.T) {
	source := &TokenSource{saved: &runnerconfig.CredentialProfile{
		AccessToken: "saved-token",
	}}
	requests := 0
	transport := AuthTransport{
		Tokens: source,
		Base: roundTripperFunc(func(request *http.Request) (*http.Response, error) {
			requests++
			if request.Header.Get("authorization") != "Bearer saved-token" || request.Header.Get("dpop") != "" {
				t.Fatalf("unexpected authorization header %q", request.Header.Get("authorization"))
			}
			return &http.Response{
				StatusCode: http.StatusUnauthorized,
				Body:       io.NopCloser(strings.NewReader("unauthorized")),
				Header:     make(http.Header),
				Request:    request,
			}, nil
		}),
	}
	request, err := http.NewRequest(http.MethodGet, "https://ama.example.test/secure", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatalf("expected unauthorized response, got %v", err)
	}
	defer response.Body.Close()
	if requests != 1 || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected no retry, requests=%d status=%d", requests, response.StatusCode)
	}
}

func TestAuthTransportReturnsGetBodyErrorWhenAuthorizingRequest(t *testing.T) {
	source := &TokenSource{saved: &runnerconfig.CredentialProfile{
		AccessToken: "saved-token",
	}}
	transport := AuthTransport{Tokens: source}
	request, err := http.NewRequest(http.MethodPost, "https://ama.example.test/secure", strings.NewReader("body"))
	if err != nil {
		t.Fatal(err)
	}
	request.GetBody = func() (io.ReadCloser, error) {
		return nil, errors.New("rewind failed")
	}
	authorized, err := transport.authorizedRequest(request, false)
	if err == nil || !strings.Contains(err.Error(), "rewind failed") {
		t.Fatalf("expected get body error, got request=%v err=%v", authorized, err)
	}
}

func TestAuthTransportUsesBearerAndStripsLegacyDPoPHeader(t *testing.T) {
	source := &TokenSource{saved: &runnerconfig.CredentialProfile{
		AccessToken: "e2e-token",
	}}
	request, err := http.NewRequest(http.MethodPatch, "https://ama.example.test/api/v1/runners/runner_1/heartbeat?ignored=yes#fragment", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("dpop", "legacy-proof-must-not-leak")
	authorized, err := (AuthTransport{Tokens: source}).authorizedRequest(request, false)
	if err != nil {
		t.Fatalf("authorizedRequest: %v", err)
	}
	if got := authorized.Header.Get("authorization"); got != "Bearer e2e-token" {
		t.Fatalf("authorization = %q", got)
	}
	if got := authorized.Header.Get("dpop"); got != "" {
		t.Fatalf("legacy DPoP proof leaked: %q", got)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
