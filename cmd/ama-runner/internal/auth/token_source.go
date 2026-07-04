package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	sdkama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

const tokenRefreshSkew = 2 * time.Minute

type TokenSource struct {
	Config     runnerconfig.Config
	HTTPClient *http.Client

	mu     sync.Mutex
	saved  *runnerconfig.CredentialProfile
	client DeviceAuthClient
}

func NewTokenSource(config runnerconfig.Config, httpClient *http.Client) (*TokenSource, error) {
	source := &TokenSource{
		Config:     config,
		HTTPClient: httpClient,
		client:     DeviceAuthClient{HTTPClient: httpClient},
	}
	if !config.TokenExplicit {
		saved, err := runnerconfig.LoadCredentialProfile(config.CredentialPath, config.APIServer)
		if err != nil {
			return nil, err
		}
		source.saved = saved
	}
	return source, nil
}

func (s *TokenSource) AccessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		if strings.TrimSpace(s.Config.Token) == "" {
			return "", fmt.Errorf("AMA token is required")
		}
		return s.Config.Token, nil
	}
	if !s.needsRefresh(*s.saved) {
		if strings.TrimSpace(s.saved.AccessToken) == "" {
			return "", fmt.Errorf("saved AMA runner token is missing an access token")
		}
		return s.saved.AccessToken, nil
	}
	return s.refreshLocked(ctx)
}

func (s *TokenSource) ForceRefresh(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saved == nil {
		return s.Config.Token, nil
	}
	return s.refreshLocked(ctx)
}

func (s *TokenSource) CanRefresh() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saved != nil && strings.TrimSpace(s.saved.RefreshToken) != ""
}

func (s *TokenSource) refreshLocked(ctx context.Context) (string, error) {
	if s.saved == nil {
		return s.Config.Token, nil
	}
	if strings.TrimSpace(s.saved.RefreshToken) == "" {
		return "", fmt.Errorf("saved AMA runner token is expired; run ama-runner auth login again")
	}
	configClient, err := sdkama.New(sdkama.ClientConfig{
		BaseURL:    s.Config.APIServer,
		HTTPClient: s.HTTPClient,
	})
	if err != nil {
		return "", err
	}
	configz, err := configClient.Configz.Get(ctx)
	if err != nil {
		return "", err
	}
	settings, err := RunnerOidcSettingsFromConfig(configz, s.Config.APIServer)
	if err != nil {
		return "", err
	}
	metadata, err := s.client.Discover(ctx, settings.Issuer)
	if err != nil {
		return "", err
	}
	token, err := s.client.RefreshToken(
		ctx,
		metadata.TokenEndpoint,
		settings.ClientID,
		s.saved.RefreshToken,
		settings.Resource,
	)
	if err != nil {
		return "", err
	}
	next := *s.saved
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
	if err := runnerconfig.SaveCredentialProfile(s.Config.CredentialPath, next); err != nil {
		return "", err
	}
	s.saved = &next
	return next.AccessToken, nil
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
