//go:build !windows

package securefile

import (
	"fmt"
	"os"
)

func restrict(_ string, file *os.File) error {
	return file.Chmod(0o600)
}

func checkPrivate(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		return fmt.Errorf("private file mode is %04o, want 0600", mode)
	}
	return nil
}
