//go:build !windows

package userdirs

import (
	"os"
	"path/filepath"
	"strings"
)

func ConfigFile(appName string, fileName string) string {
	if root := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); root != "" {
		return filepath.Join(root, appName, fileName)
	}
	if home := strings.TrimSpace(os.Getenv("HOME")); home != "" {
		return filepath.Join(home, ".config", appName, fileName)
	}
	return ""
}

func StateDir(appName string) string {
	if root := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); root != "" {
		return filepath.Join(root, appName)
	}
	if home := strings.TrimSpace(os.Getenv("HOME")); home != "" {
		return filepath.Join(home, ".local", "state", appName)
	}
	return ""
}
