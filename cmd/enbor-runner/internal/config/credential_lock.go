package config

import (
	"strings"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/lockfile"
)

func withCredentialStoreLock(path string, fn func() error) error {
	if strings.TrimSpace(path) == "" {
		return fn()
	}
	return lockfile.With(path+".lock", fn)
}
