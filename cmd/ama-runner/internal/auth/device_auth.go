package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
)

const deviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"
const refreshGrantType = "refresh_token"
const RefreshGrantType = refreshGrantType

type DeviceAuthClient struct {
	HTTPClient *http.Client
}

type DeviceLoginOptions struct {
	APIServer      string
	Issuer         string
	Resource       string
	ClientID       string
	Scopes         string
	CredentialPath string
	Output         io.Writer
	PollInterval   time.Duration
}

type DeviceLoginResult struct {
	APIServer      string
	CredentialPath string
}

type oidcMetadata struct {
	Issuer                      string `json:"issuer"`
	DeviceAuthorizationEndpoint string `json:"device_authorization_endpoint"`
	TokenEndpoint               string `json:"token_endpoint"`
	JWKSURI                     string `json:"jwks_uri"`
}

type deviceAuthorizationResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

func LoginWithDeviceAuthorization(
	ctx context.Context,
	client DeviceAuthClient,
	options DeviceLoginOptions,
) (DeviceLoginResult, error) {
	if strings.TrimSpace(options.Issuer) == "" || strings.TrimSpace(options.ClientID) == "" {
		return DeviceLoginResult{}, fmt.Errorf("AMA control plane did not publish runner OIDC metadata")
	}
	metadata, err := client.Discover(ctx, options.Issuer)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	device, err := client.StartDeviceAuthorization(
		ctx,
		metadata.DeviceAuthorizationEndpoint,
		options.ClientID,
		options.Scopes,
		options.Resource,
	)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	output := options.Output
	if output == nil {
		output = io.Discard
	}
	printDeviceInstructions(output, device)
	token, err := client.PollDeviceToken(ctx, metadata.TokenEndpoint, options.ClientID, device, options.PollInterval, options.Resource)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	if strings.TrimSpace(token.RefreshToken) == "" {
		return DeviceLoginResult{}, fmt.Errorf("OIDC token response did not include a refresh token; runner client must allow offline_access")
	}
	identity, err := client.validateIDToken(ctx, metadata, token.IDToken, options.ClientID)
	if err != nil {
		return DeviceLoginResult{}, err
	}
	if err := runnerconfig.SaveCredentialProfile(options.CredentialPath, runnerconfig.CredentialProfile{
		AccountID:    identity.Subject,
		APIServer:    strings.TrimRight(options.APIServer, "/"),
		Email:        identity.Email,
		Name:         identity.Name,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenType:    token.TokenType,
		ExpiresAt:    expiresAt(token.ExpiresIn),
		Scope:        token.Scope,
	}); err != nil {
		return DeviceLoginResult{}, err
	}
	return DeviceLoginResult{APIServer: strings.TrimRight(options.APIServer, "/"), CredentialPath: options.CredentialPath}, nil
}

type tokenIdentityClaims struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
}

func (c DeviceAuthClient) validateIDToken(
	ctx context.Context,
	metadata oidcMetadata,
	idToken string,
	clientID string,
) (tokenIdentityClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 || strings.TrimSpace(parts[1]) == "" {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC token response did not include an id token with account identity")
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if err := decodeJWTJSON(parts[0], &header); err != nil || header.Algorithm != "RS256" || header.KeyID == "" {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token header is invalid")
	}
	var keys struct {
		Keys []struct {
			KeyID     string `json:"kid"`
			KeyType   string `json:"kty"`
			Algorithm string `json:"alg"`
			Use       string `json:"use"`
			Modulus   string `json:"n"`
			Exponent  string `json:"e"`
		} `json:"keys"`
	}
	if err := c.getJSON(ctx, metadata.JWKSURI, &keys); err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("fetch OIDC signing keys: %w", err)
	}
	var publicKey *rsa.PublicKey
	for _, key := range keys.Keys {
		if key.KeyID != header.KeyID || key.KeyType != "RSA" || (key.Algorithm != "" && key.Algorithm != "RS256") || (key.Use != "" && key.Use != "sig") {
			continue
		}
		modulus, modulusErr := base64.RawURLEncoding.DecodeString(key.Modulus)
		exponent, exponentErr := base64.RawURLEncoding.DecodeString(key.Exponent)
		if modulusErr != nil || exponentErr != nil || len(modulus) == 0 || len(exponent) == 0 || len(exponent) > 4 {
			continue
		}
		e := 0
		for _, value := range exponent {
			e = e<<8 | int(value)
		}
		if e >= 3 {
			publicKey = &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: e}
			break
		}
	}
	if publicKey == nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token signing key is unavailable")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token signature is invalid")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], signature); err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token signature is invalid")
	}
	var envelope struct {
		tokenIdentityClaims
		Issuer     string          `json:"iss"`
		Audience   json.RawMessage `json:"aud"`
		Authorized string          `json:"azp"`
		ExpiresAt  int64           `json:"exp"`
		IssuedAt   int64           `json:"iat"`
	}
	if err := decodeJWTJSON(parts[1], &envelope); err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token claims are invalid: %w", err)
	}
	now := time.Now().Unix()
	if envelope.Issuer != metadata.Issuer || !audienceContains(envelope.Audience, clientID) || envelope.ExpiresAt <= now || envelope.IssuedAt <= 0 || envelope.IssuedAt > now+60 {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token claims are invalid")
	}
	if audienceCount(envelope.Audience) > 1 && envelope.Authorized != clientID {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token authorized party is invalid")
	}
	claims := envelope.tokenIdentityClaims
	claims.Subject = strings.TrimSpace(claims.Subject)
	claims.Email = strings.TrimSpace(claims.Email)
	claims.Name = strings.TrimSpace(claims.Name)
	if claims.Subject == "" {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token did not include a subject")
	}
	return claims, nil
}

func decodeJWTJSON(part string, value any) error {
	data, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

func tokenAudiences(raw json.RawMessage) []string {
	var single string
	if json.Unmarshal(raw, &single) == nil && single != "" {
		return []string{single}
	}
	var multiple []string
	if json.Unmarshal(raw, &multiple) != nil {
		return nil
	}
	return multiple
}

func audienceContains(raw json.RawMessage, expected string) bool {
	for _, audience := range tokenAudiences(raw) {
		if audience == expected {
			return true
		}
	}
	return false
}

func audienceCount(raw json.RawMessage) int {
	return len(tokenAudiences(raw))
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (c DeviceAuthClient) Discover(ctx context.Context, issuer string) (oidcMetadata, error) {
	issuer = strings.TrimRight(issuer, "/")
	endpoint := issuer + "/.well-known/openid-configuration"
	var metadata oidcMetadata
	if err := c.getJSON(ctx, endpoint, &metadata); err != nil {
		return oidcMetadata{}, err
	}
	if metadata.Issuer != issuer || metadata.DeviceAuthorizationEndpoint == "" || metadata.TokenEndpoint == "" || metadata.JWKSURI == "" {
		return oidcMetadata{}, fmt.Errorf("OIDC issuer metadata is incomplete or mismatched")
	}
	for _, value := range []string{metadata.DeviceAuthorizationEndpoint, metadata.TokenEndpoint, metadata.JWKSURI} {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()))) {
			return oidcMetadata{}, fmt.Errorf("OIDC issuer metadata contains an unsafe endpoint")
		}
	}
	return metadata, nil
}

func (c DeviceAuthClient) StartDeviceAuthorization(
	ctx context.Context,
	endpoint string,
	clientID string,
	scopes string,
	resource string,
) (deviceAuthorizationResponse, error) {
	values := url.Values{}
	values.Set("client_id", clientID)
	if strings.TrimSpace(scopes) != "" {
		values.Set("scope", scopes)
	}
	if strings.TrimSpace(resource) != "" {
		values.Set("resource", strings.TrimRight(resource, "/"))
	}
	var response deviceAuthorizationResponse
	if err := c.postForm(ctx, endpoint, values, &response); err != nil {
		return deviceAuthorizationResponse{}, err
	}
	if response.DeviceCode == "" || response.UserCode == "" || response.VerificationURI == "" || response.ExpiresIn <= 0 {
		return deviceAuthorizationResponse{}, fmt.Errorf("OIDC device authorization response is incomplete")
	}
	return response, nil
}

func (c DeviceAuthClient) PollDeviceToken(
	ctx context.Context,
	endpoint string,
	clientID string,
	device deviceAuthorizationResponse,
	fallbackInterval time.Duration,
	resource string,
) (tokenResponse, error) {
	interval := time.Duration(device.Interval) * time.Second
	if interval <= 0 {
		interval = fallbackInterval
	}
	if interval <= 0 {
		interval = 5 * time.Second
	}
	expires := time.Now().Add(time.Duration(device.ExpiresIn) * time.Second)
	for {
		if time.Now().After(expires) {
			return tokenResponse{}, fmt.Errorf("OIDC device authorization expired")
		}
		select {
		case <-ctx.Done():
			return tokenResponse{}, ctx.Err()
		case <-time.After(interval):
		}

		values := url.Values{}
		values.Set("grant_type", deviceGrantType)
		values.Set("device_code", device.DeviceCode)
		values.Set("client_id", clientID)
		if strings.TrimSpace(resource) != "" {
			values.Set("resource", strings.TrimRight(resource, "/"))
		}
		var token tokenResponse
		err := c.postForm(ctx, endpoint, values, &token)
		if err == nil && token.Error == "" {
			if token.AccessToken == "" {
				return tokenResponse{}, fmt.Errorf("OIDC token response did not include an access token")
			}
			if !strings.EqualFold(token.TokenType, "Bearer") {
				return tokenResponse{}, fmt.Errorf("Realmroot token response did not issue a Bearer token")
			}
			return token, nil
		}
		var pollErr deviceTokenError
		if err != nil && !errors.As(err, &pollErr) {
			return tokenResponse{}, err
		}
		if token.Error == "" {
			token.Error = pollErr.Code
			token.Description = pollErr.Description
		}
		switch token.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval += 5 * time.Second
			continue
		case "expired_token":
			return tokenResponse{}, fmt.Errorf("OIDC device authorization expired")
		case "access_denied":
			return tokenResponse{}, fmt.Errorf("OIDC device authorization was denied")
		default:
			return tokenResponse{}, fmt.Errorf("OIDC token polling failed: %s", errorDescription(token))
		}
	}
}

func (c DeviceAuthClient) RefreshToken(
	ctx context.Context,
	endpoint string,
	clientID string,
	refreshToken string,
	resource string,
) (tokenResponse, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return tokenResponse{}, fmt.Errorf("OIDC refresh token is required")
	}
	values := url.Values{}
	values.Set("grant_type", refreshGrantType)
	values.Set("refresh_token", refreshToken)
	values.Set("client_id", clientID)
	if strings.TrimSpace(resource) != "" {
		values.Set("resource", strings.TrimRight(resource, "/"))
	}
	var token tokenResponse
	if err := c.postForm(ctx, endpoint, values, &token); err != nil {
		return tokenResponse{}, err
	}
	if token.AccessToken == "" {
		return tokenResponse{}, fmt.Errorf("OIDC refresh response did not include an access token")
	}
	if !strings.EqualFold(token.TokenType, "Bearer") {
		return tokenResponse{}, fmt.Errorf("Realmroot refresh response did not issue a Bearer token")
	}
	return token, nil
}

func (c DeviceAuthClient) getJSON(ctx context.Context, endpoint string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	return c.do(request, out)
}

func (c DeviceAuthClient) postForm(ctx context.Context, endpoint string, values url.Values, out any) error {
	return c.postFormOnly(ctx, endpoint, values, out)
}

func (c DeviceAuthClient) postFormOnly(ctx context.Context, endpoint string, values url.Values, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/x-www-form-urlencoded")
	return c.do(request, out)
}

func (c DeviceAuthClient) do(request *http.Request, out any) error {
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		var tokenErr tokenResponse
		if json.Unmarshal(body, &tokenErr) == nil && tokenErr.Error != "" {
			return deviceTokenError{Code: tokenErr.Error, Description: tokenErr.Description}
		}
		return oidcStatusError{Path: request.URL.Path, Status: response.StatusCode}
	}
	if err := json.Unmarshal(body, out); err != nil {
		return err
	}
	return nil
}

type oidcStatusError struct {
	Path   string
	Status int
}

func (e oidcStatusError) Error() string {
	return fmt.Sprintf("OIDC %s failed with status %d", e.Path, e.Status)
}

type deviceTokenError struct {
	Code        string
	Description string
}

func (e deviceTokenError) Error() string {
	return errorDescription(tokenResponse{Error: e.Code, Description: e.Description})
}

func printDeviceInstructions(output io.Writer, device deviceAuthorizationResponse) {
	if device.VerificationURIComplete != "" {
		fmt.Fprintf(output, "Open: %s\n", device.VerificationURIComplete)
	}
	fmt.Fprintf(output, "Verification URL: %s\n", device.VerificationURI)
	fmt.Fprintf(output, "Code: %s\n", device.UserCode)
}

func expiresAt(seconds int) string {
	if seconds <= 0 {
		return ""
	}
	return time.Now().Add(time.Duration(seconds) * time.Second).UTC().Format(time.RFC3339)
}

func ExpiresAt(seconds int) string {
	return expiresAt(seconds)
}

func errorDescription(token tokenResponse) string {
	if token.Description != "" {
		return token.Description
	}
	if token.Error != "" {
		return token.Error
	}
	return "provider_error"
}
