package config

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/host"
)

type Config struct {
	ConfigPath            string        `json:"-" mapstructure:"config"`
	CredentialPath        string        `json:"-" mapstructure:"-"`
	TokenExplicit         bool          `json:"-" mapstructure:"-"`
	APIServer             string        `json:"apiServer" mapstructure:"apiServer"`
	Token                 string        `json:"-" mapstructure:"-"`
	ProjectID             string        `json:"projectId" mapstructure:"projectId"`
	EnvironmentID         string        `json:"environmentId" mapstructure:"environmentId"`
	AllowUnsafeProcess    bool          `json:"allowUnsafeProcess" mapstructure:"allowUnsafeProcess"`
	StateDir              string        `json:"stateDir" mapstructure:"stateDir"`
	WorkDir               string        `json:"workDir" mapstructure:"workDir"`
	MaxConcurrent         int           `json:"maxConcurrent" mapstructure:"maxConcurrent"`
	HeartbeatInterval     time.Duration `json:"heartbeatInterval" mapstructure:"heartbeatInterval"`
	LeaseDurationSeconds  int           `json:"leaseDurationSeconds" mapstructure:"leaseDurationSeconds"`
	RenewInterval         time.Duration `json:"renewInterval" mapstructure:"renewInterval"`
	CommandTimeout        time.Duration `json:"commandTimeout" mapstructure:"commandTimeout"`
	ShutdownGraceInterval time.Duration `json:"shutdownGraceInterval" mapstructure:"shutdownGraceInterval"`
	// MaxSessionDuration caps a single runtime session; 0 disables the cap.
	MaxSessionDuration time.Duration `json:"maxSessionDuration" mapstructure:"maxSessionDuration"`
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.APIServer) == "" {
		return fmt.Errorf("AMA API server URL is required")
	}
	parsed, err := url.Parse(c.APIServer)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("AMA API server URL must be an absolute URL")
	}
	if strings.TrimSpace(c.Token) == "" {
		return fmt.Errorf("AMA token is required")
	}
	if strings.TrimSpace(c.EnvironmentID) == "" {
		return fmt.Errorf("AMA environment id is required")
	}
	if host.SupportsAMARuntime() && !c.AllowUnsafeProcess {
		return fmt.Errorf("process-unsafe adapter requires AMA_RUNNER_ALLOW_UNSAFE_PROCESS=true or --allow-unsafe-process")
	}
	if strings.TrimSpace(c.WorkDir) == "" {
		return fmt.Errorf("work dir is required")
	}
	if strings.TrimSpace(c.StateDir) == "" {
		return fmt.Errorf("runner state directory is required")
	}
	if c.MaxConcurrent < 1 {
		return fmt.Errorf("max concurrent leases must be greater than zero")
	}
	if c.LeaseDurationSeconds < 15 || c.LeaseDurationSeconds > 900 {
		return fmt.Errorf("lease duration must be between 15 and 900 seconds")
	}
	leaseDuration := time.Duration(c.LeaseDurationSeconds) * time.Second
	if c.HeartbeatInterval <= 0 || c.HeartbeatInterval >= leaseDuration {
		return fmt.Errorf("heartbeat interval must be greater than zero and less than lease duration")
	}
	if c.RenewInterval <= 0 || c.RenewInterval >= leaseDuration {
		return fmt.Errorf("renew interval must be greater than zero and less than lease duration")
	}
	if c.CommandTimeout <= 0 || c.ShutdownGraceInterval <= 0 {
		return fmt.Errorf("command timeout and shutdown grace intervals must be greater than zero")
	}
	if c.MaxSessionDuration < 0 {
		return fmt.Errorf("max session duration must be zero (disabled) or greater")
	}
	return nil
}
