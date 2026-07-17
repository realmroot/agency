package config

import (
	"strings"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/lockfile"
)

func withCredentialStoreLock(path string, fn func() error) error {
	if strings.TrimSpace(path) == "" {
		return fn()
	}
	return lockfile.With(path+".lock", fn)
}
