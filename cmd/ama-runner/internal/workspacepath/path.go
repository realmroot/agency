package workspacepath

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

const Root = "/workspace"

func Relative(value string, allowRoot bool) (string, error) {
	value = strings.TrimSpace(value)
	if value == Root {
		if allowRoot {
			return ".", nil
		}
		return "", fmt.Errorf("workspace root is not a valid mount target")
	}
	if strings.HasPrefix(value, Root+"/") {
		value = strings.TrimPrefix(value, Root+"/")
	} else if strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("path must be under %s", Root)
	}
	if value == "" {
		return "", fmt.Errorf("workspace-relative path is required")
	}
	if strings.Contains(value, `\`) || hasWindowsVolume(value) {
		return "", fmt.Errorf("workspace paths must use forward slashes")
	}
	clean := path.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("path must stay under %s", Root)
	}
	return filepath.FromSlash(clean), nil
}

func hasWindowsVolume(value string) bool {
	return len(value) >= 2 && ((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= 'A' && value[0] <= 'Z')) && value[1] == ':'
}
