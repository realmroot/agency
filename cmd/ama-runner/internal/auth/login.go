package auth

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	sdkama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type LoginCommand struct {
	APIServer      string
	CredentialPath string
}

func ValidateLoginCommand(command LoginCommand) (LoginCommand, error) {
	if strings.TrimSpace(command.APIServer) == "" {
		return LoginCommand{}, fmt.Errorf("AMA API server URL is required")
	}
	if err := runnerconfig.ValidateAPIServerURL(command.APIServer); err != nil {
		return LoginCommand{}, err
	}
	if strings.TrimSpace(command.CredentialPath) == "" {
		return LoginCommand{}, fmt.Errorf("runner credential path is required")
	}
	return command, nil
}

func Login(ctx context.Context, command LoginCommand, output io.Writer) error {
	httpClient := &http.Client{Timeout: 30 * time.Second}
	client, err := sdkama.New(sdkama.ClientConfig{
		BaseURL:    command.APIServer,
		HTTPClient: httpClient,
	})
	if err != nil {
		return err
	}
	configz, err := client.Configz.Get(ctx)
	if err != nil {
		return err
	}
	settings, err := RunnerOidcSettingsFromConfig(configz, command.APIServer)
	if err != nil {
		return err
	}
	authClient := OAuthClient{HTTPClient: httpClient}
	result, err := LoginWithAuthorizationCode(ctx, authClient, AuthorizationCodeLoginOptions{
		APIServer:      command.APIServer,
		Issuer:         settings.Issuer,
		Resource:       settings.Resource,
		ClientID:       settings.ClientID,
		Scopes:         settings.Scopes,
		CredentialPath: command.CredentialPath,
		Output:         output,
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(output, "enbor-runner authenticated for %s; credentials saved to %s\n", result.APIServer, result.CredentialPath)
	return nil
}
