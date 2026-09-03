package testutil

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"
)

const runnerCallbackTestLockAddress = "127.0.0.1:49175"
const runnerCallbackTestLockTimeout = 30 * time.Second

// AcquireRunnerCallbackTestLock serializes tests that bind the runner's fixed
// OAuth callback port, including tests executing in separate package processes.
func AcquireRunnerCallbackTestLock(ctx context.Context) (func() error, error) {
	acquireContext, cancel := context.WithTimeout(ctx, runnerCallbackTestLockTimeout)
	defer cancel()
	retry := time.NewTicker(5 * time.Millisecond)
	defer retry.Stop()

	var lastListenError error
	for {
		listener, err := net.Listen("tcp4", runnerCallbackTestLockAddress)
		if err == nil {
			var releaseOnce sync.Once
			var releaseError error
			return func() error {
				releaseOnce.Do(func() { releaseError = listener.Close() })
				return releaseError
			}, nil
		}
		lastListenError = err
		select {
		case <-acquireContext.Done():
			return nil, fmt.Errorf(
				"acquire Enbor runner callback test lock at %s: %w (last listen error: %v)",
				runnerCallbackTestLockAddress,
				acquireContext.Err(),
				lastListenError,
			)
		case <-retry.C:
		}
	}
}
