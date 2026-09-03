//go:build linux

package workspace

import "golang.org/x/sys/unix"

func renameNoReplace(oldPath string, newPath string) error {
	return unix.Renameat2(unix.AT_FDCWD, oldPath, unix.AT_FDCWD, newPath, unix.RENAME_NOREPLACE)
}
