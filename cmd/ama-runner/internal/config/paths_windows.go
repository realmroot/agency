//go:build windows

package config

import (
	"os"
	"path/filepath"
)

func DefaultConfigPath() string {
	root, err := os.UserConfigDir()
	if err != nil || root == "" {
		return ""
	}
	return filepath.Join(root, "ama-runner", "config.json")
}

func DefaultCredentialPath() string {
	root, err := os.UserConfigDir()
	if err != nil || root == "" {
		return ""
	}
	return filepath.Join(root, "ama-runner", "credentials.json")
}

func DefaultStateDir() string {
	root, err := os.UserCacheDir()
	if err != nil || root == "" {
		return ""
	}
	return filepath.Join(root, "ama-runner")
}

func DefaultWorkDir() string {
	stateDir := DefaultStateDir()
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "work")
}
