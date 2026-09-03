package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
)

const refreshGrantType = "refresh_token"
const RefreshGrantType = refreshGrantType
const runnerCallbackURL = "http://127.0.0.1:49174/oauth/callback"
const runnerLoginTimeout = 10 * time.Minute

type OAuthClient struct {
	HTTPClient *http.Client
}

type AuthorizationCodeLoginOptions struct {
	APIServer      string
	Issuer         string
	Resource       string
	ClientID       string
	Scopes         string
	CredentialPath string
	Output         io.Writer
}

type AuthorizationCodeLoginResult struct {
	APIServer      string
	CredentialPath string
}

type oidcMetadata struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
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

func LoginWithAuthorizationCode(
	ctx context.Context,
	client OAuthClient,
	options AuthorizationCodeLoginOptions,
) (AuthorizationCodeLoginResult, error) {
	if strings.TrimSpace(options.Issuer) == "" || strings.TrimSpace(options.ClientID) == "" {
		return AuthorizationCodeLoginResult{}, fmt.Errorf("Enbor control plane did not publish runner OIDC metadata")
	}
	metadata, err := client.Discover(ctx, options.Issuer)
	if err != nil {
		return AuthorizationCodeLoginResult{}, err
	}
	state, err := randomBase64URL(32)
	if err != nil {
		return AuthorizationCodeLoginResult{}, fmt.Errorf("generate OIDC state: %w", err)
	}
	verifier, err := randomBase64URL(32)
	if err != nil {
		return AuthorizationCodeLoginResult{}, fmt.Errorf("generate PKCE verifier: %w", err)
	}
	nonce, err := randomBase64URL(32)
	if err != nil {
		return AuthorizationCodeLoginResult{}, fmt.Errorf("generate OIDC nonce: %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:49174")
	if err != nil {
		return AuthorizationCodeLoginResult{}, fmt.Errorf("start Realmroot callback listener: %w", err)
	}
	defer listener.Close()

	loginContext, cancel := context.WithTimeout(ctx, runnerLoginTimeout)
	defer cancel()
	callback := make(chan authorizationCallback, 1)
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		Handler: http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodGet || request.URL.Path != "/oauth/callback" {
				http.NotFound(response, request)
				return
			}
			query := request.URL.Query()
			if query.Get("state") != state {
				http.Error(response, "Invalid OAuth state", http.StatusBadRequest)
				return
			}
			result := authorizationCallback{Code: strings.TrimSpace(query.Get("code"))}
			if callbackIssuer := strings.TrimSpace(query.Get("iss")); callbackIssuer != "" && callbackIssuer != metadata.Issuer {
				result.Err = fmt.Errorf("OIDC callback issuer is invalid")
			} else if code := strings.TrimSpace(query.Get("error")); code != "" {
				result.Err = fmt.Errorf("OIDC authorization failed: %s", safeOAuthError(code, query.Get("error_description")))
			} else if result.Code == "" {
				result.Err = fmt.Errorf("OIDC callback did not include an authorization code")
			}
			select {
			case callback <- result:
			default:
			}
			if result.Err != nil {
				http.Error(response, "Enbor Runner authentication failed. You may close this window.", http.StatusBadRequest)
				return
			}
			response.Header().Set("content-type", "text/plain; charset=utf-8")
			_, _ = io.WriteString(response, "Enbor Runner authentication complete. You may close this window.\n")
		}),
	}
	serverError := make(chan error, 1)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			serverError <- serveErr
		}
	}()
	defer func() {
		shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownContext)
	}()

	authorizationURL, err := buildAuthorizationURL(metadata.AuthorizationEndpoint, options, state, verifier, nonce)
	if err != nil {
		return AuthorizationCodeLoginResult{}, err
	}
	output := options.Output
	if output == nil {
		output = io.Discard
	}
	fmt.Fprintf(output, "Open: %s\n", authorizationURL)

	var code string
	select {
	case <-loginContext.Done():
		return AuthorizationCodeLoginResult{}, loginContext.Err()
	case err := <-serverError:
		return AuthorizationCodeLoginResult{}, fmt.Errorf("serve Realmroot callback: %w", err)
	case result := <-callback:
		if result.Err != nil {
			return AuthorizationCodeLoginResult{}, result.Err
		}
		code = result.Code
	}

	token, err := client.ExchangeAuthorizationCode(loginContext, metadata.TokenEndpoint, options.ClientID, code, verifier, options.Resource)
	if err != nil {
		return AuthorizationCodeLoginResult{}, err
	}
	if strings.TrimSpace(token.RefreshToken) == "" {
		return AuthorizationCodeLoginResult{}, fmt.Errorf("OIDC token response did not include a refresh token; runner client must allow offline_access")
	}
	identity, err := client.validateIDToken(ctx, metadata, token.IDToken, options.ClientID, nonce)
	if err != nil {
		return AuthorizationCodeLoginResult{}, err
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
		return AuthorizationCodeLoginResult{}, err
	}
	return AuthorizationCodeLoginResult{APIServer: strings.TrimRight(options.APIServer, "/"), CredentialPath: options.CredentialPath}, nil
}

type authorizationCallback struct {
	Code string
	Err  error
}

type tokenIdentityClaims struct {
	Subject string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
}

func (c OAuthClient) validateIDToken(
	ctx context.Context,
	metadata oidcMetadata,
	idToken string,
	clientID string,
	expectedNonce string,
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
		Nonce      string          `json:"nonce"`
	}
	if err := decodeJWTJSON(parts[1], &envelope); err != nil {
		return tokenIdentityClaims{}, fmt.Errorf("OIDC id token claims are invalid: %w", err)
	}
	now := time.Now().Unix()
	if envelope.Issuer != metadata.Issuer || !audienceContains(envelope.Audience, clientID) || envelope.ExpiresAt <= now || envelope.IssuedAt <= 0 || envelope.IssuedAt > now+60 || envelope.Nonce != expectedNonce {
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

func (c OAuthClient) Discover(ctx context.Context, issuer string) (oidcMetadata, error) {
	issuer = strings.TrimRight(issuer, "/")
	endpoint := issuer + "/.well-known/openid-configuration"
	var metadata oidcMetadata
	if err := c.getJSON(ctx, endpoint, &metadata); err != nil {
		return oidcMetadata{}, err
	}
	if metadata.Issuer != issuer || metadata.AuthorizationEndpoint == "" || metadata.TokenEndpoint == "" || metadata.JWKSURI == "" {
		return oidcMetadata{}, fmt.Errorf("OIDC issuer metadata is incomplete or mismatched")
	}
	for _, value := range []string{metadata.AuthorizationEndpoint, metadata.TokenEndpoint, metadata.JWKSURI} {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()))) {
			return oidcMetadata{}, fmt.Errorf("OIDC issuer metadata contains an unsafe endpoint")
		}
	}
	return metadata, nil
}

func (c OAuthClient) ExchangeAuthorizationCode(
	ctx context.Context,
	endpoint string,
	clientID string,
	code string,
	verifier string,
	resource string,
) (tokenResponse, error) {
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("code", code)
	values.Set("client_id", clientID)
	values.Set("redirect_uri", runnerCallbackURL)
	values.Set("code_verifier", verifier)
	if strings.TrimSpace(resource) != "" {
		values.Set("resource", strings.TrimRight(resource, "/"))
	}
	var token tokenResponse
	if err := c.postForm(ctx, endpoint, values, &token); err != nil {
		return tokenResponse{}, err
	}
	if token.AccessToken == "" {
		return tokenResponse{}, fmt.Errorf("OIDC token response did not include an access token")
	}
	if !strings.EqualFold(token.TokenType, "Bearer") {
		return tokenResponse{}, fmt.Errorf("Realmroot token response did not issue a Bearer token")
	}
	return token, nil
}

func (c OAuthClient) RefreshToken(
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

func (c OAuthClient) getJSON(ctx context.Context, endpoint string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	return c.do(request, out)
}

func (c OAuthClient) postForm(ctx context.Context, endpoint string, values url.Values, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/x-www-form-urlencoded")
	return c.do(request, out)
}

func (c OAuthClient) do(request *http.Request, out any) error {
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
			return oauthTokenError{Code: tokenErr.Error, Description: tokenErr.Description}
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

type oauthTokenError struct {
	Code        string
	Description string
}

func (e oauthTokenError) Error() string {
	return errorDescription(tokenResponse{Error: e.Code, Description: e.Description})
}

func randomBase64URL(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func buildAuthorizationURL(
	endpoint string,
	options AuthorizationCodeLoginOptions,
	state string,
	verifier string,
	nonce string,
) (string, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("parse OIDC authorization endpoint: %w", err)
	}
	challenge := sha256.Sum256([]byte(verifier))
	query := parsed.Query()
	query.Set("response_type", "code")
	query.Set("client_id", options.ClientID)
	query.Set("redirect_uri", runnerCallbackURL)
	query.Set("scope", options.Scopes)
	query.Set("resource", strings.TrimRight(options.Resource, "/"))
	query.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	query.Set("code_challenge_method", "S256")
	query.Set("state", state)
	query.Set("nonce", nonce)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func safeOAuthError(code string, description string) string {
	code = strings.TrimSpace(code)
	description = strings.TrimSpace(description)
	if description == "" {
		return code
	}
	return code + ": " + description
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
