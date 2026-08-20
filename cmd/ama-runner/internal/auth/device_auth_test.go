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
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/securefile"
)

const testDPoPPrivateKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE"

var testRSAKey = sync.OnceValue(func() *rsa.PrivateKey {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	return key
})

func TestLoginPerformsHealthCheckAndDeviceFlow(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/configz":
			_ = json.NewEncoder(w).Encode(testPublicConfig(
				"http://"+r.Host,
				"https://ama.example.test",
				"runner-client",
				[]string{"openid", "offline_access"},
			))
		case "/device":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":      "device",
				"user_code":        "ABCD-EFGH",
				"verification_uri": "https://issuer.example.test/device",
				"expires_in":       60,
			})
		case "/token":
			if r.FormValue("resource") != "https://ama.example.test" {
				t.Fatalf("unexpected token request resource: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "access-token",
				"refresh_token": "refresh-token",
				"id_token":      testIDToken("http://"+r.Host, "runner-client", "user_1", "runner@example.test", "Runner"),
				"token_type":    "DPoP",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	})
	defer server.Close()

	var output bytes.Buffer
	if err := Login(context.Background(), LoginCommand{APIServer: server.URL, CredentialPath: credentialPath}, &output); err != nil {
		t.Fatalf("expected login success, got %v", err)
	}
	if !strings.Contains(output.String(), "authenticated") || strings.Contains(output.String(), "access-token") {
		t.Fatalf("unexpected login output: %s", output.String())
	}
	profile, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if profile == nil || profile.AccountID != "user_1" || profile.AccessToken != "access-token" {
		t.Fatalf("expected saved profile, got %#v", profile)
	}
}

func TestLoginWithDeviceAuthorizationStoresTokenWithoutPrintingIt(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "ama-runner", "credentials.json")
	polls := 0
	deviceJKT := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        "http://" + r.Host,
				"device_authorization_endpoint": "http://" + r.Host + "/device",
				"token_endpoint":                "http://" + r.Host + "/token",
				"jwks_uri":                      "http://" + r.Host + "/jwks",
			})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(testJWKS())
		case "/device":
			if r.FormValue("client_id") != "runner-client" || r.FormValue("scope") != "openid profile email offline_access" {
				t.Fatalf("unexpected device request form: %s", r.Form.Encode())
			}
			if r.FormValue("resource") != "https://ama.example.test" || r.FormValue("dpop_jkt") == "" {
				t.Fatalf("expected exact resource and DPoP JKT: %s", r.Form.Encode())
			}
			deviceJKT = r.FormValue("dpop_jkt")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":               "device-code",
				"user_code":                 "ABCD-EFGH",
				"verification_uri":          "https://issuer.example.test/device",
				"verification_uri_complete": "https://issuer.example.test/device?user_code=ABCD-EFGH",
				"expires_in":                60,
				"interval":                  0,
			})
		case "/token":
			polls += 1
			if r.Header.Get("dpop") == "" {
				t.Fatal("expected token poll DPoP proof")
			}
			if r.FormValue("grant_type") != deviceGrantType ||
				r.FormValue("device_code") != "device-code" ||
				r.FormValue("resource") != "https://ama.example.test" {
				t.Fatalf("unexpected token request form: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "access-token-secret",
				"refresh_token": "refresh-token-secret",
				"id_token":      testIDToken("http://"+r.Host, "runner-client", "user_1", "runner@example.test", "Runner User"),
				"token_type":    "DPoP",
				"expires_in":    3600,
				"scope":         "openid profile email offline_access",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	var output bytes.Buffer
	result, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
		APIServer:      "https://ama.example.test",
		Issuer:         server.URL,
		Resource:       "https://ama.example.test",
		ClientID:       "runner-client",
		Scopes:         "openid profile email offline_access",
		CredentialPath: credentialPath,
		Output:         &output,
		PollInterval:   time.Millisecond,
	})
	if err != nil {
		t.Fatalf("expected login to succeed, got %v", err)
	}
	if result.CredentialPath != credentialPath || polls != 1 {
		t.Fatalf("unexpected result %#v polls=%d", result, polls)
	}
	if strings.Contains(output.String(), "access-token-secret") || strings.Contains(output.String(), "refresh-token-secret") {
		t.Fatalf("login output leaked token material: %s", output.String())
	}
	if !strings.Contains(output.String(), "ABCD-EFGH") || !strings.Contains(output.String(), "https://issuer.example.test/device") {
		t.Fatalf("login output omitted device instructions: %s", output.String())
	}

	if err := securefile.CheckPrivate(credentialPath); err != nil {
		t.Fatalf("expected private credential permissions: %v", err)
	}
	saved, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.AccountID != "user_1" || saved.Email != "runner@example.test" || saved.Name != "Runner User" ||
		saved.AccessToken != "access-token-secret" || saved.RefreshToken != "refresh-token-secret" {
		t.Fatalf("unexpected saved credentials: %#v", saved)
	}
	savedJKT, err := dpopJKT(saved.DPoPPrivateKey)
	if err != nil || savedJKT != deviceJKT {
		t.Fatalf("expected device and token flow to retain one DPoP key, device=%q saved=%q err=%v", deviceJKT, savedJKT, err)
	}
}

func TestLoginWithDeviceAuthorizationRejectsUnsupportedDeviceEndpointMediaType(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "ama-runner", "credentials.json")
	deviceRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        "http://" + r.Host,
				"device_authorization_endpoint": "http://" + r.Host + "/device",
				"token_endpoint":                "http://" + r.Host + "/token",
				"jwks_uri":                      "http://" + r.Host + "/jwks",
			})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(testJWKS())
		case "/device":
			deviceRequests += 1
			if strings.HasPrefix(r.Header.Get("content-type"), "application/x-www-form-urlencoded") {
				w.WriteHeader(http.StatusUnsupportedMediaType)
				_, _ = w.Write([]byte(`{"code":"UNSUPPORTED_MEDIA_TYPE"}`))
				return
			}
			if r.Header.Get("content-type") != "application/json" {
				t.Fatalf("expected JSON fallback request, got %s", r.Header.Get("content-type"))
			}
			var payload map[string]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("expected JSON device payload, got %v", err)
			}
			if payload["client_id"] != "runner-client" || payload["scope"] != "openid profile email offline_access" {
				t.Fatalf("unexpected device JSON payload: %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"device_code":      "device-code",
				"user_code":        "ABCD-EFGH",
				"verification_uri": "https://issuer.example.test/device",
				"expires_in":       60,
			})
		case "/token":
			if r.FormValue("grant_type") != deviceGrantType ||
				r.FormValue("device_code") != "device-code" ||
				r.FormValue("resource") != "https://ama.example.test" {
				t.Fatalf("unexpected token request form: %s", r.Form.Encode())
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token":  "access-token-secret",
				"refresh_token": "refresh-token-secret",
				"id_token":      testIDToken("http://"+r.Host, "runner-client", "user_1", "runner@example.test", "Runner User"),
				"token_type":    "DPoP",
				"expires_in":    3600,
				"scope":         "openid profile email offline_access",
			})
		default:
			t.Fatalf("unexpected request %s", r.URL.Path)
		}
	}))
	defer server.Close()

	_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
		APIServer:      "https://ama.example.test",
		Issuer:         server.URL,
		Resource:       "https://ama.example.test",
		ClientID:       "runner-client",
		Scopes:         "openid profile email offline_access",
		CredentialPath: credentialPath,
		Output:         io.Discard,
		PollInterval:   time.Millisecond,
	})
	if err == nil || !strings.Contains(err.Error(), "415") {
		t.Fatalf("expected fail-closed device endpoint error, got %v", err)
	}
	if deviceRequests != 1 {
		t.Fatalf("expected a single form request, got %d requests", deviceRequests)
	}
	saved, loadErr := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if saved != nil {
		t.Fatalf("expected no credentials to be saved, got %#v", saved)
	}
}

func TestLoginWithDeviceAuthorizationErrors(t *testing.T) {
	t.Run("missing metadata", func(t *testing.T) {
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{}, DeviceLoginOptions{
			APIServer:      "https://ama.example.test",
			CredentialPath: filepath.Join(t.TempDir(), "credentials.json"),
		})
		if err == nil || !strings.Contains(err.Error(), "OIDC metadata") {
			t.Fatalf("expected metadata error, got %v", err)
		}
	})

	t.Run("discovery failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"issuer":"issuer"}`))
		}))
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			APIServer:      "https://ama.example.test",
			Issuer:         server.URL,
			ClientID:       "runner-client",
			CredentialPath: filepath.Join(t.TempDir(), "credentials.json"),
		})
		if err == nil || !strings.Contains(err.Error(), "incomplete or mismatched") {
			t.Fatalf("expected discovery error, got %v", err)
		}
	})

	t.Run("device start failure", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/device" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_client","error_description":"runner client rejected"}`))
				return
			}
			t.Fatalf("unexpected request %s", r.URL.Path)
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			APIServer:      "https://ama.example.test",
			Issuer:         server.URL,
			ClientID:       "runner-client",
			CredentialPath: filepath.Join(t.TempDir(), "credentials.json"),
		})
		if err == nil || !strings.Contains(err.Error(), "runner client rejected") {
			t.Fatalf("expected device start error, got %v", err)
		}
	})

	t.Run("poll failure", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/device":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_code":      "device-code",
					"user_code":        "ABCD-EFGH",
					"verification_uri": "https://issuer.example.test/device",
					"expires_in":       60,
				})
			case "/token":
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"access_denied"}`))
			default:
				t.Fatalf("unexpected request %s", r.URL.Path)
			}
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			APIServer:      "https://ama.example.test",
			Issuer:         server.URL,
			ClientID:       "runner-client",
			CredentialPath: filepath.Join(t.TempDir(), "credentials.json"),
			PollInterval:   time.Millisecond,
		})
		if err == nil || !strings.Contains(err.Error(), "denied") {
			t.Fatalf("expected poll error, got %v", err)
		}
	})

	t.Run("save failure", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/device":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_code":      "device-code",
					"user_code":        "ABCD-EFGH",
					"verification_uri": "https://issuer.example.test/device",
					"expires_in":       60,
				})
			case "/token":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"access_token":  "token",
					"refresh_token": "refresh",
					"id_token":      testIDToken("http://"+r.Host, "runner-client", "user_1", "runner@example.test", "Runner User"),
					"token_type":    "DPoP",
				})
			default:
				t.Fatalf("unexpected request %s", r.URL.Path)
			}
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			APIServer:    "https://ama.example.test",
			Issuer:       server.URL,
			ClientID:     "runner-client",
			PollInterval: time.Millisecond,
		})
		if err == nil || !strings.Contains(err.Error(), "credential path") {
			t.Fatalf("expected save credential error, got %v", err)
		}
	})

	t.Run("missing refresh token", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/device":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_code":      "device-code",
					"user_code":        "ABCD-EFGH",
					"verification_uri": "https://issuer.example.test/device",
					"expires_in":       60,
				})
			case "/token":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"access_token": "token",
					"id_token":     testIDToken("http://"+r.Host, "runner-client", "user_1", "runner@example.test", "Runner User"),
					"token_type":   "DPoP",
				})
			default:
				t.Fatalf("unexpected request %s", r.URL.Path)
			}
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			APIServer:      "https://ama.example.test",
			Issuer:         server.URL,
			ClientID:       "runner-client",
			CredentialPath: filepath.Join(t.TempDir(), "credentials.json"),
			PollInterval:   time.Millisecond,
		})
		if err == nil || !strings.Contains(err.Error(), "refresh token") {
			t.Fatalf("expected missing refresh token error, got %v", err)
		}
	})

	t.Run("invalid identity token", func(t *testing.T) {
		server := loginTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/device":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"device_code":      "device-code",
					"user_code":        "ABCD-EFGH",
					"verification_uri": "https://issuer.example.test/device",
					"expires_in":       60,
				})
			case "/token":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"access_token":  "token",
					"refresh_token": "refresh",
					"id_token":      "bad.payload.",
					"token_type":    "DPoP",
				})
			default:
				t.Fatalf("unexpected request %s", r.URL.Path)
			}
		})
		defer server.Close()
		_, err := LoginWithDeviceAuthorization(context.Background(), DeviceAuthClient{HTTPClient: server.Client()}, DeviceLoginOptions{
			APIServer:      "https://ama.example.test",
			Issuer:         server.URL,
			ClientID:       "runner-client",
			CredentialPath: filepath.Join(t.TempDir(), "credentials.json"),
			PollInterval:   time.Millisecond,
		})
		if err == nil || !strings.Contains(err.Error(), "id token header") {
			t.Fatalf("expected invalid identity token error, got %v", err)
		}
	})
}

func TestDeviceTokenPollingHandlesPendingSlowDownExpiredAndErrors(t *testing.T) {
	t.Run("rejects unsupported token endpoint media type", func(t *testing.T) {
		polls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			polls += 1
			if strings.HasPrefix(r.Header.Get("content-type"), "application/x-www-form-urlencoded") {
				w.WriteHeader(http.StatusUnsupportedMediaType)
				_, _ = w.Write([]byte(`{"code":"UNSUPPORTED_MEDIA_TYPE"}`))
				return
			}
			if r.Header.Get("content-type") != "application/json" {
				t.Fatalf("expected JSON fallback request, got %s", r.Header.Get("content-type"))
			}
			var payload map[string]string
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("expected JSON token payload, got %v", err)
			}
			if payload["grant_type"] != deviceGrantType ||
				payload["client_id"] != "runner-client" ||
				payload["device_code"] != "device" {
				t.Fatalf("unexpected token JSON payload: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"access_token":"token","token_type":"DPoP"}`))
		}))
		defer server.Close()
		token, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "415") || token.AccessToken != "" || polls != 1 {
			t.Fatalf("expected fail-closed token endpoint error, token=%#v polls=%d err=%v", token, polls, err)
		}
	})

	t.Run("pending then slow down then success", func(t *testing.T) {
		polls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			polls += 1
			switch polls {
			case 1:
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"authorization_pending"}`))
			case 2:
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"slow_down"}`))
			default:
				_, _ = w.Write([]byte(`{"access_token":"token","token_type":"DPoP"}`))
			}
		}))
		defer server.Close()
		token, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err != nil || token.AccessToken != "token" || polls != 3 {
			t.Fatalf("unexpected polling result token=%#v polls=%d err=%v", token, polls, err)
		}
	})

	t.Run("provider error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_request","error_description":"bad device code"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "bad device code") {
			t.Fatalf("expected provider error, got %v", err)
		}
	})

	t.Run("expired token response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"expired_token"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "expired") {
			t.Fatalf("expected expired error, got %v", err)
		}
	})

	t.Run("access denied", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"access_denied"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "denied") {
			t.Fatalf("expected denied error, got %v", err)
		}
	})

	t.Run("missing access token", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"token_type":"DPoP"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).PollDeviceToken(
			context.Background(),
			server.URL,
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "access token") {
			t.Fatalf("expected missing access token error, got %v", err)
		}
	})

	t.Run("local expiry", func(t *testing.T) {
		_, err := (DeviceAuthClient{}).PollDeviceToken(
			context.Background(),
			"https://issuer.example.test/token",
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: -1},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "expired") {
			t.Fatalf("expected local expiry error, got %v", err)
		}
	})

	t.Run("context cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := (DeviceAuthClient{}).PollDeviceToken(
			ctx,
			"https://issuer.example.test/token",
			"runner-client",
			deviceAuthorizationResponse{DeviceCode: "device", ExpiresIn: 60},
			time.Millisecond,
			"",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "context canceled") {
			t.Fatalf("expected context cancellation, got %v", err)
		}
	})
}

func TestDeviceAuthorizationStartAndDiscoveryErrors(t *testing.T) {
	t.Run("device endpoint provider error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_client","error_description":"client rejected"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).StartDeviceAuthorization(
			context.Background(),
			server.URL,
			"runner-client",
			"openid profile email offline_access",
			"https://ama.example.test",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "client rejected") {
			t.Fatalf("expected device endpoint error, got %v", err)
		}
	})

	t.Run("incomplete device response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"device_code":"device"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).StartDeviceAuthorization(
			context.Background(),
			server.URL,
			"runner-client",
			"openid profile email offline_access",
			"https://ama.example.test",
			testDPoPPrivateKey,
		)
		if err == nil || !strings.Contains(err.Error(), "incomplete") {
			t.Fatalf("expected incomplete response error, got %v", err)
		}
	})

	t.Run("incomplete discovery metadata", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"issuer":"issuer"}`))
		}))
		defer server.Close()
		_, err := (DeviceAuthClient{HTTPClient: server.Client()}).Discover(context.Background(), server.URL)
		if err == nil || !strings.Contains(err.Error(), "incomplete or mismatched") {
			t.Fatalf("expected discovery endpoint error, got %v", err)
		}
	})
}

func TestLoginCommandValidation(t *testing.T) {
	_, err := ValidateLoginCommand(LoginCommand{})
	if err == nil || !strings.Contains(err.Error(), "AMA API server URL is required") {
		t.Fatalf("expected missing API server error, got %v", err)
	}
	_, err = ValidateLoginCommand(LoginCommand{APIServer: "://bad", CredentialPath: "/tmp/credentials.json"})
	if err == nil || !strings.Contains(err.Error(), "absolute URL") {
		t.Fatalf("expected malformed API server error, got %v", err)
	}
	command, err := ValidateLoginCommand(LoginCommand{
		APIServer:      "https://ama.example.test",
		CredentialPath: "/tmp/credentials.json",
	})
	if err != nil {
		t.Fatalf("expected login command config, got %v", err)
	}
	if command.APIServer != "https://ama.example.test" || command.CredentialPath != "/tmp/credentials.json" {
		t.Fatalf("unexpected login command: %#v", command)
	}
}

func TestOIDCStatusErrorString(t *testing.T) {
	err := oidcStatusError{Path: "/token", Status: http.StatusBadGateway}
	if got := err.Error(); !strings.Contains(got, "/token") || !strings.Contains(got, "502") {
		t.Fatalf("unexpected status error string %q", got)
	}
}

func TestValidateIDTokenRequiresTrustedRS256Claims(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(testJWKS())
	}))
	defer server.Close()
	metadata := oidcMetadata{Issuer: "https://issuer.example.test", JWKSURI: server.URL}
	now := time.Now().Unix()
	base := map[string]any{
		"iss": metadata.Issuer, "aud": "runner-client", "sub": "user_1",
		"email": "runner@example.test", "name": "Runner", "iat": now, "exp": now + 300,
	}
	valid := testSignedIDToken(base, testRSAKey())
	identity, err := (DeviceAuthClient{HTTPClient: server.Client()}).validateIDToken(context.Background(), metadata, valid, "runner-client")
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
		{name: "wrong issuer", claims: cloneClaims(base, "iss", "https://other.example.test"), key: testRSAKey(), want: "claims are invalid"},
		{name: "wrong audience", claims: cloneClaims(base, "aud", "other-client"), key: testRSAKey(), want: "claims are invalid"},
		{name: "expired", claims: cloneClaims(base, "exp", now-1), key: testRSAKey(), want: "claims are invalid"},
		{name: "wrong authorized party", claims: cloneClaims(base, "aud", []string{"runner-client", "other-client"}, "azp", "other-client"), key: testRSAKey(), want: "authorized party is invalid"},
		{name: "untrusted signing key", claims: base, key: otherKey, want: "signature is invalid"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (DeviceAuthClient{HTTPClient: server.Client()}).validateIDToken(
				context.Background(), metadata, testSignedIDToken(tc.claims, tc.key), "runner-client",
			)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}

	emptyJWKS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	defer emptyJWKS.Close()
	metadata.JWKSURI = emptyJWKS.URL
	if _, err := (DeviceAuthClient{HTTPClient: emptyJWKS.Client()}).validateIDToken(context.Background(), metadata, valid, "runner-client"); err == nil || !strings.Contains(err.Error(), "signing key is unavailable") {
		t.Fatalf("expected missing JWKS key error, got %v", err)
	}
}

func TestRefreshTokenValidationAndDefaults(t *testing.T) {
	if _, err := (DeviceAuthClient{}).RefreshToken(context.Background(), "https://issuer.example.test/token", "runner-client", " ", "", testDPoPPrivateKey); err == nil {
		t.Fatal("expected missing refresh token error")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.FormValue("resource") != "https://ama.example.test" {
			t.Fatalf("unexpected refresh resource: %s", r.Form.Encode())
		}
		_, _ = w.Write([]byte(`{"access_token":"fresh","token_type":"DPoP"}`))
	}))
	defer server.Close()
	token, err := (DeviceAuthClient{HTTPClient: server.Client()}).RefreshToken(
		context.Background(),
		server.URL,
		"runner-client",
		"refresh",
		"https://ama.example.test",
		testDPoPPrivateKey,
	)
	if err != nil {
		t.Fatalf("expected refresh success, got %v", err)
	}
	if token.AccessToken != "fresh" || token.TokenType != "DPoP" {
		t.Fatalf("expected DPoP token, got %#v", token)
	}
}

func TestLoadActiveCredentialProfileRejectsExpiredToken(t *testing.T) {
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID:      "acct_1",
		APIServer:      "https://ama.example.test",
		AccessToken:    "expired-token",
		TokenType:      "DPoP",
		DPoPPrivateKey: testDPoPPrivateKey,
		ExpiresAt:      time.Now().Add(-time.Hour).UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	_, err := runnerconfig.LoadActiveCredentialProfile(credentialPath)
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired saved token error, got %v", err)
	}
}

func TestRunnerConfigValidationHelpers(t *testing.T) {
	if err := runnerconfig.SaveCredentialProfile("", runnerconfig.CredentialProfile{AccessToken: "token"}); err == nil {
		t.Fatal("expected missing credential path error")
	}
	if err := runnerconfig.SaveCredentialProfile(filepath.Join(t.TempDir(), "credentials.json"), runnerconfig.CredentialProfile{}); err == nil {
		t.Fatal("expected missing access token error")
	}
	malformedPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(malformedPath, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := runnerconfig.LoadActiveCredentialProfile(malformedPath); err == nil {
		t.Fatal("expected malformed config error")
	}
	badDatePath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(badDatePath, runnerconfig.CredentialProfile{
		AccountID:      "acct_1",
		APIServer:      "https://ama.example.test",
		AccessToken:    "token",
		TokenType:      "DPoP",
		DPoPPrivateKey: testDPoPPrivateKey,
		ExpiresAt:      "soon",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := runnerconfig.LoadActiveCredentialProfile(badDatePath); err == nil {
		t.Fatal("expected malformed expiry error")
	}
	if expiresAt(0) != "" {
		t.Fatal("expected no expiry for non-positive token lifetime")
	}
	if errorDescription(tokenResponse{Description: "described"}) != "described" {
		t.Fatal("expected description to win")
	}
	if errorDescription(tokenResponse{Error: "invalid_request"}) != "invalid_request" {
		t.Fatal("expected error code fallback")
	}
	if errorDescription(tokenResponse{}) != "provider_error" {
		t.Fatal("expected provider fallback")
	}
	if (deviceTokenError{Code: "slow_down", Description: "wait"}).Error() != "wait" {
		t.Fatal("expected device token error description")
	}
}

func loginTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(map[string]string{
				"issuer":                        server.URL,
				"device_authorization_endpoint": server.URL + "/device",
				"token_endpoint":                server.URL + "/token",
				"jwks_uri":                      server.URL + "/jwks",
			})
			return
		}
		if r.URL.Path == "/jwks" {
			_ = json.NewEncoder(w).Encode(testJWKS())
			return
		}
		handler(w, r)
	}))
	return server
}

func testJWKS() map[string]any {
	key := testRSAKey().PublicKey
	return map[string]any{"keys": []map[string]string{{
		"kid": "test-key", "kty": "RSA", "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString([]byte{1, 0, 1}),
	}}}
}

func testIDToken(issuer string, audience string, subject string, email string, name string) string {
	now := time.Now().Unix()
	return testSignedIDToken(map[string]any{
		"iss": issuer, "aud": audience, "sub": subject, "email": email, "name": name,
		"iat": now, "exp": now + 300,
	}, testRSAKey())
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
