package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	device, err := client.StartDeviceAuthorization(ctx, metadata.DeviceAuthorizationEndpoint, options.ClientID, options.Scopes)
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
	identity, err := tokenIdentity(token.IDToken)
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

func tokenIdentity(idToken string) (tokenIdentityClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 || strings.TrimSpace(parts[1]) == "" {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC token response did not include an id token with account identity")
	}
	data, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token payload is invalid: %w", err)
	}
	var claims tokenIdentityClaims
	if err := json.Unmarshal(data, &claims); err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token claims are invalid: %w", err)
	}
	claims.Subject = strings.TrimSpace(claims.Subject)
	claims.Email = strings.TrimSpace(claims.Email)
	claims.Name = strings.TrimSpace(claims.Name)
	if claims.Subject == "" {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token did not include a subject")
	}
	return claims, nil
}

func (c DeviceAuthClient) Discover(ctx context.Context, issuer string) (oidcMetadata, error) {
	endpoint := strings.TrimRight(issuer, "/") + "/.well-known/openid-configuration"
	var metadata oidcMetadata
	if err := c.getJSON(ctx, endpoint, &metadata); err != nil {
		return oidcMetadata{}, err
	}
	if metadata.DeviceAuthorizationEndpoint == "" || metadata.TokenEndpoint == "" {
		return oidcMetadata{}, fmt.Errorf("OIDC issuer metadata does not include device and token endpoints")
	}
	return metadata, nil
}

func (c DeviceAuthClient) StartDeviceAuthorization(
	ctx context.Context,
	endpoint string,
	clientID string,
	scopes string,
) (deviceAuthorizationResponse, error) {
	values := url.Values{}
	values.Set("client_id", clientID)
	if strings.TrimSpace(scopes) != "" {
		values.Set("scope", scopes)
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
			if token.TokenType == "" {
				token.TokenType = "Bearer"
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
	if token.TokenType == "" {
		token.TokenType = "Bearer"
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
	if err := c.postFormOnly(ctx, endpoint, values, out); !isUnsupportedMediaType(err) {
		return err
	}
	return c.postJSON(ctx, endpoint, formValuesJSON(values), out)
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

func (c DeviceAuthClient) postJSON(ctx context.Context, endpoint string, values map[string]string, out any) error {
	data, err := json.Marshal(values)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/json")
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

func isUnsupportedMediaType(err error) bool {
	var statusErr oidcStatusError
	return errors.As(err, &statusErr) && statusErr.Status == http.StatusUnsupportedMediaType
}

func formValuesJSON(values url.Values) map[string]string {
	result := map[string]string{}
	for key := range values {
		result[key] = values.Get(key)
	}
	return result
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
