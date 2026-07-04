package auth

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

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
	parsed, err := url.Parse(command.APIServer)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return LoginCommand{}, fmt.Errorf("AMA API server URL must be an absolute URL")
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
	health, err := client.System.Health(ctx)
	if err != nil {
		return err
	}
	if err := EnsureCompatibleHealth(health); err != nil {
		return err
	}
	authClient := DeviceAuthClient{HTTPClient: httpClient}
	result, err := LoginWithDeviceAuthorization(ctx, authClient, DeviceLoginOptions{
		APIServer:      command.APIServer,
		Issuer:         StringValue(health.OidcIssuer),
		Resource:       oidcResource(health.OidcResource, command.APIServer),
		ClientID:       StringValue(health.RunnerClientId),
		Scopes:         StringValue(health.RunnerScopes),
		CredentialPath: command.CredentialPath,
		Output:         output,
		PollInterval:   time.Second,
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(output, "ama-runner authenticated for %s; credentials saved to %s\n", result.APIServer, result.CredentialPath)
	return nil
}
