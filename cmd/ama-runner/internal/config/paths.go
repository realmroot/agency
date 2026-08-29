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

const instanceIDPrefix = "runner_"

func DefaultConfigPath() string {
	return userdirs.ConfigFile(appDirectoryName, "config.json")
}

func DefaultCredentialPath() string {
	return userdirs.ConfigFile(appDirectoryName, "credentials.json")
}

func DefaultStateDir() string {
	return userdirs.StateDir(appDirectoryName)
}

func DefaultInstanceConfigDir() string {
	path := userdirs.ConfigFile(appDirectoryName, "instances")
	if path == "" {
		return ""
	}
	return path
}

func DefaultStateDirForInstance(apiServer string, environmentID string) (string, error) {
	stateDir := DefaultStateDir()
	if stateDir == "" {
		return "", nil
	}
	storageKey, err := apiServerStorageKey(apiServer)
	if err != nil {
		return "", err
	}
	environmentKey, err := environmentStorageKey(environmentID)
	if err != nil {
		return "", err
	}
	return filepath.Join(stateDir, "servers", storageKey, "environments", environmentKey), nil
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

func InstanceID(apiServer string, environmentID string) (string, error) {
	if err := ValidateAPIServerURL(apiServer); err != nil {
		return "", err
	}
	if strings.TrimSpace(environmentID) == "" {
		return "", fmt.Errorf("AMA environment id is required")
	}
	parsed, err := url.Parse(strings.TrimSpace(apiServer))
	if err != nil {
		return "", fmt.Errorf("parse AMA API server URL: %w", err)
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	digest := sha256.Sum256([]byte(parsed.String() + "\x00" + strings.TrimSpace(environmentID)))
	return instanceIDPrefix + hex.EncodeToString(digest[:8]), nil
}

func environmentStorageKey(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("AMA environment id is required")
	}
	digest := sha256.Sum256([]byte(value))
	readable := strings.Map(func(character rune) rune {
		if unicode.IsLetter(character) || unicode.IsDigit(character) || character == '.' || character == '-' || character == '_' {
			return character
		}
		return '-'
	}, value)
	readable = strings.Trim(readable, "-.")
	if len(readable) > 48 {
		readable = readable[:48]
	}
	if readable == "" {
		readable = "environment"
	}
	return readable + "-" + hex.EncodeToString(digest[:8]), nil
}
