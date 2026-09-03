package daemon

import (
	"net/http"
	"time"

	runnerauth "github.com/realmroot/enbor/cmd/enbor-runner/internal/auth"
	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sandbox"
	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/version"
	enborsdk "github.com/realmroot/enbor/sdk/go/enbor"
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
	client, err := enborsdk.NewRunner(enborsdk.ClientConfig{
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
