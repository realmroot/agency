//go:build windows

package userdirs

import (
	"os"
	"path/filepath"
)

func ConfigFile(appName string, fileName string) string {
	root, err := os.UserConfigDir()
	if err != nil || root == "" {
		return ""
	}
	return filepath.Join(root, appName, fileName)
}

func StateDir(appName string) string {
	root, err := os.UserCacheDir()
	if err != nil || root == "" {
		return ""
	}
	return filepath.Join(root, appName)
}
