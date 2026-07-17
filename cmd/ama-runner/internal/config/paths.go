package config

import (
	"path/filepath"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/userdirs"
)

const appDirectoryName = "ama-runner"

func DefaultConfigPath() string {
	return userdirs.ConfigFile(appDirectoryName, "config.json")
}

func DefaultCredentialPath() string {
	return userdirs.ConfigFile(appDirectoryName, "credentials.json")
}

func DefaultStateDir() string {
	return userdirs.StateDir(appDirectoryName)
}

func DefaultWorkDir() string {
	stateDir := DefaultStateDir()
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "work")
}
