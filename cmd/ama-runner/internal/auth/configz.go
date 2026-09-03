package auth

import (
	"fmt"
	"strings"

	sdkama "github.com/realmroot/agency/sdk/go/enbor"
)

type RunnerOidcSettings struct {
	Issuer   string
	Resource string
	ClientID string
	Scopes   string
}

func EnsureCompatibleConfig(config *sdkama.PublicConfig) error {
	if config == nil {
		return fmt.Errorf("AMA config response is empty")
	}
	if config.Version != sdkama.N1 || config.Service.Name != sdkama.AnyManagedAgents {
		return fmt.Errorf("incompatible AMA control plane: %s/%v", config.Service.Name, config.Version)
	}
	return nil
}

func RunnerOidcSettingsFromConfig(config *sdkama.PublicConfig, fallbackResource string) (RunnerOidcSettings, error) {
	if err := EnsureCompatibleConfig(config); err != nil {
		return RunnerOidcSettings{}, err
	}
	if config.Auth.Oidc == nil {
		return RunnerOidcSettings{}, fmt.Errorf("AMA config is missing OIDC settings")
	}
	oidc := config.Auth.Oidc
	if strings.TrimSpace(oidc.Issuer) == "" {
		return RunnerOidcSettings{}, fmt.Errorf("AMA config is missing OIDC issuer")
	}
	if oidc.Runner == nil || strings.TrimSpace(oidc.Runner.ClientId) == "" {
		return RunnerOidcSettings{}, fmt.Errorf("AMA config is missing runner OIDC client")
	}
	scopes := strings.Join(oidc.Runner.Scopes, " ")
	if strings.TrimSpace(scopes) == "" {
		return RunnerOidcSettings{}, fmt.Errorf("AMA config is missing runner OIDC scopes")
	}
	return RunnerOidcSettings{
		Issuer:   strings.TrimSpace(oidc.Issuer),
		Resource: oidcResource(oidc.Resource, fallbackResource),
		ClientID: strings.TrimSpace(oidc.Runner.ClientId),
		Scopes:   scopes,
	}, nil
}
