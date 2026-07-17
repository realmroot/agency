package lockfile

import (
	"errors"
	"os"
	"path/filepath"
)

var ErrLocked = errors.New("lock file is already held")

type Lock struct {
	file *os.File
}

func With(path string, fn func() error) error {
	lock, err := acquire(path, false)
	if err != nil {
		return err
	}
	defer lock.Close()
	return fn()
}

func TryAcquire(path string) (*Lock, error) {
	return acquire(path, true)
}

func acquire(path string, nonBlocking bool) (*Lock, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lock(file, nonBlocking); err != nil {
		_ = file.Close()
		return nil, err
	}
	return &Lock{file: file}, nil
}

func (l *Lock) ReplaceContents(contents string) error {
	if err := l.file.Truncate(0); err != nil {
		return err
	}
	if _, err := l.file.WriteAt([]byte(contents), 0); err != nil {
		return err
	}
	return l.file.Sync()
}

func (l *Lock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	unlockErr := unlock(l.file)
	closeErr := l.file.Close()
	l.file = nil
	if unlockErr != nil {
		return unlockErr
	}
	return closeErr
}
