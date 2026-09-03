//go:build windows

package workspace

import "golang.org/x/sys/windows"

func renameNoReplace(oldPath string, newPath string) error {
	oldPathPointer, err := windows.UTF16PtrFromString(oldPath)
	if err != nil {
		return err
	}
	newPathPointer, err := windows.UTF16PtrFromString(newPath)
	if err != nil {
		return err
	}
	return windows.MoveFile(oldPathPointer, newPathPointer)
}
