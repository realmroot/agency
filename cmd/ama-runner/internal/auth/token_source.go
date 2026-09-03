package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	sdkama "github.com/realmroot/agency/sdk/go/enbor"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
)

const tokenRefreshSkew = 2 * time.Minute

type TokenSource struct {
	Config     runnerconfig.Config
	HTTPClient *http.Client

	mu     sync.Mutex
	saved  *runnerconfig.CredentialProfile
	client OAuthClient
}

func NewTokenSource(config runnerconfig.Config, httpClient *http.Client) (*TokenSource, error) {
	source := &TokenSource{
		Config:     config,
		HTTPClient: httpClient,
		client:     OAuthClient{HTTPClient: httpClient},
	}
	saved, err := runnerconfig.LoadCredentialProfileByAccountID(config.CredentialPath, config.APIServer, config.CredentialAccountID)
	if err != nil {
		return nil, err
	}
	if saved == nil || !strings.EqualFold(strings.TrimSpace(saved.TokenType), "Bearer") {
		return nil, fmt.Errorf("Enbor Runner requires a Realmroot Bearer login; run enbor-runner auth login")
	}
	source.saved = saved
	return source, nil
}

func (s *TokenSource) AccessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		return "", fmt.Errorf("Enbor Runner requires a Realmroot Bearer login")
	}
	if !s.needsRefresh(*s.saved) {
		if strings.TrimSpace(s.saved.AccessToken) == "" {
			return "", fmt.Errorf("saved Enbor Runner token is missing an access token")
		}
		return s.saved.AccessToken, nil
	}
	return s.refreshLocked(ctx, false)
}

func (s *TokenSource) ForceRefresh(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		return "", fmt.Errorf("Enbor Runner requires a Realmroot Bearer login")
	}
	return s.refreshLocked(ctx, true)
}

func (s *TokenSource) CanRefresh() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saved != nil && strings.TrimSpace(s.saved.RefreshToken) != ""
}

func (s *TokenSource) refreshLocked(ctx context.Context, force bool) (string, error) {
	if s.saved == nil {
		return "", fmt.Errorf("Enbor Runner requires a Realmroot Bearer login")
	}
	previousAccessToken := s.saved.AccessToken
	update := runnerconfig.UpdateCredentialProfile
	if s.Config.CredentialAccountID != "" {
		update = func(path string, apiServer string, callback func(runnerconfig.CredentialProfile) (runnerconfig.CredentialProfile, bool, error)) (runnerconfig.CredentialProfile, error) {
			return runnerconfig.UpdateCredentialProfileByAccountID(path, apiServer, s.Config.CredentialAccountID, callback)
		}
	}
	next, err := update(
		s.Config.CredentialPath,
		s.Config.APIServer,
		func(current runnerconfig.CredentialProfile) (runnerconfig.CredentialProfile, bool, error) {
			if !force && !s.needsRefresh(current) {
				if strings.TrimSpace(current.AccessToken) == "" {
					return current, false, fmt.Errorf("saved Enbor Runner token is missing an access token")
				}
				return current, false, nil
			}
			if force && strings.TrimSpace(current.AccessToken) != "" && current.AccessToken != previousAccessToken && !s.needsRefresh(current) {
				return current, false, nil
			}
			if strings.TrimSpace(current.RefreshToken) == "" {
				return current, false, fmt.Errorf("saved Enbor Runner token is expired; run enbor-runner auth login again")
			}
			refreshed, err := s.refreshCredentialProfile(ctx, current)
			if err != nil {
				return current, false, err
			}
			return refreshed, true, nil
		},
	)
	if err != nil {
		return "", err
	}
	s.saved = &next
	return next.AccessToken, nil
}

func (s *TokenSource) refreshCredentialProfile(ctx context.Context, current runnerconfig.CredentialProfile) (runnerconfig.CredentialProfile, error) {
	configClient, err := sdkama.New(sdkama.ClientConfig{
		BaseURL:    s.Config.APIServer,
		HTTPClient: s.HTTPClient,
	})
	if err != nil {
		return runnerconfig.CredentialProfile{}, err
	}
	configz, err := configClient.Configz.Get(ctx)
	if err != nil {
		return runnerconfig.CredentialProfile{}, err
	}
	settings, err := RunnerOidcSettingsFromConfig(configz, s.Config.APIServer)
	if err != nil {
		return runnerconfig.CredentialProfile{}, err
	}
	metadata, err := s.client.Discover(ctx, settings.Issuer)
	if err != nil {
		return runnerconfig.CredentialProfile{}, err
	}
	token, err := s.client.RefreshToken(
		ctx,
		metadata.TokenEndpoint,
		settings.ClientID,
		current.RefreshToken,
		settings.Resource,
	)
	if err != nil {
		return runnerconfig.CredentialProfile{}, err
	}
	next := current
	next.APIServer = strings.TrimRight(s.Config.APIServer, "/")
	next.AccessToken = token.AccessToken
	if strings.TrimSpace(token.RefreshToken) != "" {
		next.RefreshToken = token.RefreshToken
	}
	next.TokenType = token.TokenType
	next.ExpiresAt = ExpiresAt(token.ExpiresIn)
	if strings.TrimSpace(token.Scope) != "" {
		next.Scope = token.Scope
	}
	return next, nil
}

func oidcResource(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimRight(strings.TrimSpace(value), "/")
	}
	return strings.TrimRight(strings.TrimSpace(fallback), "/")
}

func (s *TokenSource) needsRefresh(config runnerconfig.CredentialProfile) bool {
	if strings.TrimSpace(config.AccessToken) == "" {
		return true
	}
	if strings.TrimSpace(config.ExpiresAt) == "" {
		return false
	}
	expiresAt, err := time.Parse(time.RFC3339, config.ExpiresAt)
	if err != nil {
		return true
	}
	return !expiresAt.After(time.Now().Add(tokenRefreshSkew))
}
