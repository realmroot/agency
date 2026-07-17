package securefile

import (
	"os"
	"path/filepath"
)

func Write(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := restrict(path, file); err != nil {
		return err
	}
	if err := file.Truncate(0); err != nil {
		return err
	}
	if _, err := file.WriteAt(data, 0); err != nil {
		return err
	}
	return file.Sync()
}

func CheckPrivate(path string) error {
	return checkPrivate(path)
}
