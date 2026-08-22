package testutil

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

func TestAcquireRunnerCallbackTestLockSerializesAndReleases(t *testing.T) {
	firstRelease, err := AcquireRunnerCallbackTestLock(t.Context())
	if err != nil {
		t.Fatalf("acquire first callback test lock: %v", err)
	}
	if listener, listenErr := net.Listen("tcp4", runnerCallbackTestLockAddress); listenErr == nil {
		_ = listener.Close()
		t.Fatal("coordination listener accepted a second owner")
	}

	type acquisition struct {
		release func() error
		err     error
	}
	second := make(chan acquisition, 1)
	go func() {
		release, acquireErr := AcquireRunnerCallbackTestLock(t.Context())
		second <- acquisition{release: release, err: acquireErr}
	}()
	if err := firstRelease(); err != nil {
		t.Fatalf("release first callback test lock: %v", err)
	}

	select {
	case acquired := <-second:
		if acquired.err != nil {
			t.Fatalf("acquire callback test lock after release: %v", acquired.err)
		}
		if err := acquired.release(); err != nil {
			t.Fatalf("release second callback test lock: %v", err)
		}
		if err := acquired.release(); err != nil {
			t.Fatalf("idempotent callback test lock release: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("second callback test lock did not acquire after release")
	}
}

func TestAcquireRunnerCallbackTestLockHonorsContext(t *testing.T) {
	release, err := AcquireRunnerCallbackTestLock(t.Context())
	if err != nil {
		t.Fatalf("acquire callback test lock: %v", err)
	}
	defer func() {
		if releaseErr := release(); releaseErr != nil {
			t.Errorf("release callback test lock: %v", releaseErr)
		}
	}()

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = AcquireRunnerCallbackTestLock(ctx)
	if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), runnerCallbackTestLockAddress) || !strings.Contains(err.Error(), "last listen error") {
		t.Fatalf("expected bounded callback lock acquisition error, got %v", err)
	}
}
