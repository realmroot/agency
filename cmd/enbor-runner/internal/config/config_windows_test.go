//go:build windows

package config

import (
	"testing"
	"time"
)

func TestWindowsCLIOnlyConfigDoesNotRequireUnsafeAdapter(t *testing.T) {
	config := Config{
		APIServer:             "https://enbor.example.test",
		CredentialPath:        `C:\Users\runner\AppData\Roaming\enbor-runner\credentials.json`,
		EnvironmentID:         "env_1",
		StateDir:              t.TempDir(),
		WorkDir:               t.TempDir(),
		MaxConcurrent:         1,
		HeartbeatInterval:     20 * time.Second,
		LeaseDurationSeconds:  60,
		RenewInterval:         20 * time.Second,
		CommandTimeout:        time.Second,
		ShutdownGraceInterval: time.Millisecond,
	}
	if err := config.Validate(); err != nil {
		t.Fatalf("expected CLI-only Windows config to validate without unsafe adapter acknowledgement: %v", err)
	}
}
