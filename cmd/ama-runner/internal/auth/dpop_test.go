package auth

import (
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestDPoPKeyThumbprintAndProofClaims(t *testing.T) {
	privateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatalf("newDPoPPrivateKey: %v", err)
	}
	thumbprint, err := dpopJKT(privateKey)
	if err != nil {
		t.Fatalf("dpopJKT: %v", err)
	}
	if thumbprint == "" {
		t.Fatal("expected a non-empty JWK thumbprint")
	}

	now := time.Unix(1_750_000_000, 0)
	proof, err := signDPoPProof(
		privateKey,
		http.MethodPost,
		"https://id.example.test/token?ignored=yes#fragment",
		"access-token",
		"server-nonce",
		now,
	)
	if err != nil {
		t.Fatalf("signDPoPProof: %v", err)
	}
	parts := strings.Split(proof, ".")
	if len(parts) != 3 || parts[2] == "" {
		t.Fatalf("expected signed compact JWT, got %q", proof)
	}
	var header map[string]any
	if err := decodeJWTJSON(parts[0], &header); err != nil {
		t.Fatalf("decode header: %v", err)
	}
	if header["alg"] != "ES256" || header["typ"] != "dpop+jwt" {
		t.Fatalf("unexpected DPoP header: %#v", header)
	}
	var claims map[string]any
	if err := decodeJWTJSON(parts[1], &claims); err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	if claims["htm"] != http.MethodPost || claims["htu"] != "https://id.example.test/token" {
		t.Fatalf("unexpected request binding: %#v", claims)
	}
	if claims["nonce"] != "server-nonce" || claims["ath"] == "" || claims["jti"] == "" {
		t.Fatalf("expected nonce, ath, and jti claims: %#v", claims)
	}
	if claims["iat"] != float64(now.Unix()) {
		t.Fatalf("unexpected iat: %#v", claims["iat"])
	}
}

func TestDPoPProofOmitsOptionalClaimsAndAcceptsLoopback(t *testing.T) {
	privateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatalf("newDPoPPrivateKey: %v", err)
	}
	proof, err := signDPoPProof(privateKey, http.MethodGet, "http://[::1]:8787/path?x=1", "", "", time.Unix(10, 0))
	if err != nil {
		t.Fatalf("signDPoPProof: %v", err)
	}
	var claims map[string]any
	if err := decodeJWTJSON(strings.Split(proof, ".")[1], &claims); err != nil {
		t.Fatalf("decode claims: %v", err)
	}
	if claims["htu"] != "http://[::1]:8787/path" {
		t.Fatalf("unexpected loopback htu: %#v", claims["htu"])
	}
	if _, ok := claims["ath"]; ok {
		t.Fatal("ath must be omitted without an access token")
	}
	if _, ok := claims["nonce"]; ok {
		t.Fatal("nonce must be omitted without a challenge")
	}
}

func TestDPoPRejectsInvalidKeysAndUnsafeURLs(t *testing.T) {
	invalidScalars := []string{
		"not-base64!",
		base64.RawURLEncoding.EncodeToString(make([]byte, 31)),
		base64.RawURLEncoding.EncodeToString(make([]byte, 32)),
		base64.RawURLEncoding.EncodeToString(new(big.Int).Set(elliptic.P256().Params().N).FillBytes(make([]byte, 32))),
	}
	for _, scalar := range invalidScalars {
		if _, err := decodeDPoPPrivateKey(scalar); err == nil {
			t.Fatalf("expected invalid scalar %q to be rejected", scalar)
		}
		if _, err := dpopJKT(scalar); err == nil {
			t.Fatalf("expected thumbprint to reject scalar %q", scalar)
		}
	}

	privateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatalf("newDPoPPrivateKey: %v", err)
	}
	unsafe := []string{
		"/relative",
		"https://user@example.test/path",
		"http://example.test/path",
		"ftp://example.test/path",
	}
	for _, requestURL := range unsafe {
		if _, err := signDPoPProof(privateKey, http.MethodGet, requestURL, "", "", time.Now()); err == nil {
			t.Fatalf("expected unsafe URL %q to be rejected", requestURL)
		}
	}
	for _, requestURL := range []string{"http://localhost:8787/path", "http://127.0.0.1:8787/path"} {
		if _, err := normalizedDPoPURL(requestURL); err != nil {
			t.Fatalf("expected loopback URL %q to be accepted: %v", requestURL, err)
		}
	}
}

func TestDPoPEncodingAndNonceRetryHelpers(t *testing.T) {
	if _, err := encodeJWTPart(make(chan int)); err == nil {
		t.Fatal("expected unsupported JWT value to fail JSON encoding")
	}

	privateKey, err := newDPoPPrivateKey()
	if err != nil {
		t.Fatalf("newDPoPPrivateKey: %v", err)
	}
	attempt := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		attempt++
		proof := request.Header.Get("DPoP")
		parts := strings.Split(proof, ".")
		if len(parts) != 3 {
			t.Errorf("missing DPoP proof on attempt %d", attempt)
		}
		var claims map[string]any
		if len(parts) == 3 {
			if err := decodeJWTJSON(parts[1], &claims); err != nil {
				t.Errorf("decode DPoP claims: %v", err)
			}
		}
		w.Header().Set("content-type", "application/json")
		if attempt == 1 {
			if _, ok := claims["nonce"]; ok {
				t.Error("initial proof unexpectedly included a nonce")
			}
			w.Header().Set("DPoP-Nonce", "retry-nonce")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "use_dpop_nonce"})
			return
		}
		if claims["nonce"] != "retry-nonce" {
			t.Errorf("retry proof nonce = %#v", claims["nonce"])
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "fresh", "token_type": "DPoP"})
	}))
	defer server.Close()

	var token tokenResponse
	client := DeviceAuthClient{HTTPClient: server.Client()}
	if err := client.postDpopForm(t.Context(), server.URL, url.Values{"grant_type": {refreshGrantType}}, privateKey, &token); err != nil {
		t.Fatalf("postDpopForm: %v", err)
	}
	if attempt != 2 || token.AccessToken != "fresh" {
		t.Fatalf("unexpected nonce retry result: attempts=%d token=%#v", attempt, token)
	}
}
