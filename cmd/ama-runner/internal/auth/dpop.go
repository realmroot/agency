package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"
)

func newDPoPPrivateKey() (string, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", fmt.Errorf("generate DPoP key: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(privateKey.D.FillBytes(make([]byte, 32))), nil
}

func dpopJKT(encodedPrivateKey string) (string, error) {
	privateKey, err := decodeDPoPPrivateKey(encodedPrivateKey)
	if err != nil {
		return "", err
	}
	x := base64.RawURLEncoding.EncodeToString(privateKey.X.FillBytes(make([]byte, 32)))
	y := base64.RawURLEncoding.EncodeToString(privateKey.Y.FillBytes(make([]byte, 32)))
	canonical := []byte(fmt.Sprintf(`{"crv":"P-256","kty":"EC","x":"%s","y":"%s"}`, x, y))
	digest := sha256.Sum256(canonical)
	return base64.RawURLEncoding.EncodeToString(digest[:]), nil
}

func decodeDPoPPrivateKey(encoded string) (*ecdsa.PrivateKey, error) {
	scalar, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(scalar) != 32 {
		return nil, errors.New("DPoP private key is invalid")
	}
	d := new(big.Int).SetBytes(scalar)
	curve := elliptic.P256()
	if d.Sign() <= 0 || d.Cmp(curve.Params().N) >= 0 {
		return nil, errors.New("DPoP private key is invalid")
	}
	x, y := curve.ScalarBaseMult(scalar)
	return &ecdsa.PrivateKey{PublicKey: ecdsa.PublicKey{Curve: curve, X: x, Y: y}, D: d}, nil
}

func signDPoPProof(encodedPrivateKey, method, requestURL, accessToken, nonce string, now time.Time) (string, error) {
	privateKey, err := decodeDPoPPrivateKey(encodedPrivateKey)
	if err != nil {
		return "", err
	}
	htu, err := normalizedDPoPURL(requestURL)
	if err != nil {
		return "", err
	}
	jtiBytes := make([]byte, 16)
	if _, err := rand.Read(jtiBytes); err != nil {
		return "", err
	}
	header := map[string]any{
		"alg": "ES256",
		"typ": "dpop+jwt",
		"jwk": map[string]string{
			"kty": "EC",
			"crv": "P-256",
			"x":   base64.RawURLEncoding.EncodeToString(privateKey.X.FillBytes(make([]byte, 32))),
			"y":   base64.RawURLEncoding.EncodeToString(privateKey.Y.FillBytes(make([]byte, 32))),
		},
	}
	payload := map[string]any{
		"htm": strings.ToUpper(method),
		"htu": htu,
		"iat": now.Unix(),
		"jti": base64.RawURLEncoding.EncodeToString(jtiBytes),
	}
	if accessToken != "" {
		digest := sha256.Sum256([]byte(accessToken))
		payload["ath"] = base64.RawURLEncoding.EncodeToString(digest[:])
	}
	if nonce != "" {
		payload["nonce"] = nonce
	}
	encodedHeader, err := encodeJWTPart(header)
	if err != nil {
		return "", err
	}
	encodedPayload, err := encodeJWTPart(payload)
	if err != nil {
		return "", err
	}
	unsigned := encodedHeader + "." + encodedPayload
	digest := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, privateKey, digest[:])
	if err != nil {
		return "", err
	}
	signature := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func encodeJWTPart(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func normalizedDPoPURL(value string) (string, error) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return "", errors.New("DPoP URL must be absolute and contain no userinfo")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return "", errors.New("DPoP URL must use HTTPS except for loopback development")
	}
	parsed.Fragment = ""
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	return parsed.String(), nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
