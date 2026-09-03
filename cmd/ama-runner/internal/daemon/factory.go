package daemon

import (
	"net/http"
	"time"

	sdkama "github.com/realmroot/agency/sdk/go/enbor"
	runnerauth "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/auth"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
)

func New(config runnerconfig.Config, build version.Info) (*Daemon, error) {
	baseHTTPClient := &http.Client{Timeout: 30 * time.Second}
	tokens, err := runnerauth.NewTokenSource(config, baseHTTPClient)
	if err != nil {
		return nil, err
	}
	authHTTPClient := &http.Client{
		Timeout: 30 * time.Second,
		Transport: runnerauth.AuthTransport{
			Base:   http.DefaultTransport,
			Tokens: tokens,
		},
	}
	client, err := sdkama.NewRunner(sdkama.ClientConfig{
		BaseURL:    config.APIServer,
		ProjectID:  config.ProjectID,
		HTTPClient: authHTTPClient,
	})
	if err != nil {
		return nil, err
	}
	return &Daemon{
		Config:   config,
		Client:   client,
		Channels: client.Runners,
		Adapter:  sandbox.NewHostAdapter(config.CommandTimeout, config.ShutdownGraceInterval),
		Build:    build,
	}, nil
}
