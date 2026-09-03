package config

import (
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/host"
)

func ValidateAPIServerURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("Enbor API server URL must be an absolute URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("Enbor API server URL must not contain userinfo, query, or fragment")
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	loopback := host == "localhost" || ip != nil && ip.IsLoopback()
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return fmt.Errorf("Enbor API server URL must use HTTPS except for loopback development")
	}
	return nil
}

type Config struct {
	ConfigPath            string        `json:"-" mapstructure:"config"`
	CredentialPath        string        `json:"-" mapstructure:"-"`
	CredentialAccountID   string        `json:"-" mapstructure:"-"`
	APIServer             string        `json:"apiServer" mapstructure:"apiServer"`
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
		return fmt.Errorf("Enbor API server URL is required")
	}
	if err := ValidateAPIServerURL(c.APIServer); err != nil {
		return err
	}
	if strings.TrimSpace(c.EnvironmentID) == "" {
		return fmt.Errorf("Enbor environment id is required")
	}
	if host.SupportsEnborRuntime() && !c.AllowUnsafeProcess {
		return fmt.Errorf("process-unsafe adapter requires ENBOR_RUNNER_ALLOW_UNSAFE_PROCESS=true or --allow-unsafe-process")
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
