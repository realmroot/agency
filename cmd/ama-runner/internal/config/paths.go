//go:build !windows

package config

import (
	"os"
	"path/filepath"
	"strings"
)

func DefaultConfigPath() string {
	if configHome := os.Getenv("XDG_CONFIG_HOME"); strings.TrimSpace(configHome) != "" {
		return filepath.Join(configHome, "ama-runner", "config.json")
	}
	if home := os.Getenv("HOME"); strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".config", "ama-runner", "config.json")
	}
	return ""
}

func DefaultCredentialPath() string {
	if configHome := os.Getenv("XDG_CONFIG_HOME"); strings.TrimSpace(configHome) != "" {
		return filepath.Join(configHome, "ama-runner", "credentials.json")
	}
	if home := os.Getenv("HOME"); strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".config", "ama-runner", "credentials.json")
	}
	return ""
}

func DefaultStateDir() string {
	if stateHome := os.Getenv("XDG_STATE_HOME"); strings.TrimSpace(stateHome) != "" {
		return filepath.Join(stateHome, "ama-runner")
	}
	if home := os.Getenv("HOME"); strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".local", "state", "ama-runner")
	}
	return ""
}

func DefaultWorkDir() string {
	stateDir := DefaultStateDir()
	if strings.TrimSpace(stateDir) == "" {
		return ""
	}
	return filepath.Join(stateDir, "work")
}
