package config

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"unicode"

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

func DefaultStateDirForAPIServer(apiServer string) (string, error) {
	stateDir := DefaultStateDir()
	if stateDir == "" {
		return "", nil
	}
	storageKey, err := apiServerStorageKey(apiServer)
	if err != nil {
		return "", err
	}
	return filepath.Join(stateDir, "servers", storageKey), nil
}

func DefaultWorkDirForStateDir(stateDir string) string {
	if strings.TrimSpace(stateDir) == "" {
		return ""
	}
	return filepath.Join(stateDir, "work")
}

func apiServerStorageKey(value string) (string, error) {
	if err := ValidateAPIServerURL(value); err != nil {
		return "", err
	}
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", fmt.Errorf("parse AMA API server URL: %w", err)
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	normalized := parsed.String()
	digest := sha256.Sum256([]byte(normalized))
	host := strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) || character == '.' || character == '-' {
			return unicode.ToLower(character)
		}
		return '-'
	}, parsed.Hostname())
	if port := parsed.Port(); port != "" {
		host += "-" + port
	}
	return host + "-" + hex.EncodeToString(digest[:16]), nil
}
