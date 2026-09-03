package lockfile

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestTryAcquireRejectsSecondOwner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runner.lock")
	first, err := TryAcquire(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if err := first.ReplaceContents("123\n"); err != nil {
		t.Fatal(err)
	}
	second, err := TryAcquire(path)
	if second != nil {
		_ = second.Close()
	}
	if !errors.Is(err, ErrLocked) {
		t.Fatalf("expected ErrLocked, got %v", err)
	}
}

func TestWithSerializesOwners(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.lock")
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- With(path, func() error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	second := make(chan error, 1)
	secondStarted := make(chan struct{})
	go func() {
		close(secondStarted)
		second <- With(path, func() error { return nil })
	}()
	<-secondStarted
	select {
	case err := <-second:
		t.Fatalf("second owner entered before release: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := <-second; err != nil {
		t.Fatal(err)
	}
}
