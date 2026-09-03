//go:build darwin

package managed

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

func syncServiceStartAtLogin(string, bool) error {
	return nil
}

func startServiceNow(serviceName string, startAtLogin bool) error {
	if startAtLogin {
		return nil
	}
	output, err := exec.Command("launchctl", "start", serviceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl start %s: %w: %s", serviceName, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func updateServiceStartAtLogin(serviceName string, enabled bool) (func() error, error) {
	homeDir, err := launchdUserHomeDir()
	if err != nil {
		return nil, err
	}
	plistPath := filepath.Join(homeDir, "Library", "LaunchAgents", serviceName+".plist")
	return updateLaunchAgentPlist(plistPath, enabled)
}

func launchdUserHomeDir() (string, error) {
	current, err := user.Current()
	if err == nil {
		return current.HomeDir, nil
	}
	homeDir := strings.TrimSpace(os.Getenv("HOME"))
	if homeDir == "" {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	return homeDir, nil
}

func updateLaunchAgentPlist(plistPath string, enabled bool) (func() error, error) {
	previousRunAtLoad, err := readPlistBool(plistPath, "RunAtLoad")
	if err != nil {
		return nil, err
	}
	previousKeepAlive, err := readPlistBool(plistPath, "KeepAlive")
	if err != nil {
		return nil, err
	}
	if err := replacePlistBool(plistPath, "RunAtLoad", enabled); err != nil {
		return nil, err
	}
	if err := replacePlistBool(plistPath, "KeepAlive", enabled); err != nil {
		if rollbackErr := restoreLaunchAgentPolicy(plistPath, previousRunAtLoad, previousKeepAlive); rollbackErr != nil {
			return nil, fmt.Errorf("%w; rollback login startup failed: %v", err, rollbackErr)
		}
		return nil, err
	}
	return func() error {
		return restoreLaunchAgentPolicy(plistPath, previousRunAtLoad, previousKeepAlive)
	}, nil
}

func readPlistBool(path string, key string) (bool, error) {
	output, err := exec.Command("plutil", "-extract", key, "raw", "-o", "-", path).CombinedOutput()
	if err != nil {
		return false, fmt.Errorf("read %s in %s: %w: %s", key, path, err, strings.TrimSpace(string(output)))
	}
	value, err := strconv.ParseBool(strings.TrimSpace(string(output)))
	if err != nil {
		return false, fmt.Errorf("read %s in %s: %w", key, path, err)
	}
	return value, nil
}

func restoreLaunchAgentPolicy(path string, runAtLoad bool, keepAlive bool) error {
	return errors.Join(
		replacePlistBool(path, "RunAtLoad", runAtLoad),
		replacePlistBool(path, "KeepAlive", keepAlive),
	)
}

func replacePlistBool(path string, key string, value bool) error {
	output, err := exec.Command("plutil", "-replace", key, "-bool", strconv.FormatBool(value), path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("set %s in %s: %w: %s", key, path, err, strings.TrimSpace(string(output)))
	}
	return nil
}
