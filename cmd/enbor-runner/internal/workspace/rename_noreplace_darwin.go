//go:build darwin

package workspace

import "golang.org/x/sys/unix"

func renameNoReplace(oldPath string, newPath string) error {
	return unix.RenameatxNp(unix.AT_FDCWD, oldPath, unix.AT_FDCWD, newPath, unix.RENAME_EXCL)
}
