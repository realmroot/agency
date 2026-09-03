package daemon

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/lockfile"
)

const runnerLockFileName = "runner.lock"

func acquireStateDirLock(stateDir string) (func(), error) {
	if strings.TrimSpace(stateDir) == "" {
		return nil, fmt.Errorf("runner state directory is required")
	}
	lock, err := lockfile.TryAcquire(filepath.Join(stateDir, runnerLockFileName))
	if errors.Is(err, lockfile.ErrLocked) {
		return nil, fmt.Errorf("enbor-runner is already running with state directory %s; stop the existing process or use a different --state-dir", stateDir)
	}
	if err != nil {
		return nil, err
	}
	if err := lock.ReplaceContents(fmt.Sprintf("%d\n", os.Getpid())); err != nil {
		_ = lock.Close()
		return nil, err
	}
	return func() { _ = lock.Close() }, nil
}
