package runtimebridge

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"os"
	"path/filepath"
)

//go:embed bundle.mjs
var bundle []byte

func Materialize() (string, error) {
	hash := sha256.Sum256(bundle)
	name := "ama-runtime-bridge-" + hex.EncodeToString(hash[:8]) + ".mjs"
	root, err := os.UserCacheDir()
	if err != nil {
		root = os.TempDir()
	}
	dir := filepath.Join(root, "ama-runner")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if existing, err := os.ReadFile(path); err == nil && bytes.Equal(existing, bundle) {
		return path, nil
	}
	temp, err := os.CreateTemp(dir, name+".*.tmp")
	if err != nil {
		return "", err
	}
	tempPath := temp.Name()
	defer func() {
		_ = os.Remove(tempPath)
	}()
	if _, err := temp.Write(bundle); err != nil {
		_ = temp.Close()
		return "", err
	}
	if err := temp.Chmod(0o755); err != nil {
		_ = temp.Close()
		return "", err
	}
	if err := temp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tempPath, path); err != nil {
		if existing, readErr := os.ReadFile(path); readErr == nil && bytes.Equal(existing, bundle) {
			return path, nil
		}
		return "", err
	}
	return path, nil
}

func Bytes() []byte {
	return append([]byte(nil), bundle...)
}
