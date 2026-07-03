//go:build !windows

package daemon

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

const runnerLockFileName = "runner.lock"

func acquireStateDirLock(stateDir string) (func(), error) {
	if strings.TrimSpace(stateDir) == "" {
		return nil, fmt.Errorf("runner state directory is required")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(stateDir, runnerLockFileName)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, fmt.Errorf("ama-runner is already running with state directory %s; stop the existing process or use a different --state-dir", stateDir)
		}
		return nil, err
	}
	if err := file.Truncate(0); err == nil {
		if _, writeErr := file.WriteString(fmt.Sprintf("%d\n", os.Getpid())); writeErr == nil {
			_ = file.Sync()
		}
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, nil
}
