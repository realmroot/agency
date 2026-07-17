package securefile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteCreatesPrivateFileAndReplacesContents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "credentials.json")
	if err := Write(path, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := CheckPrivate(path); err != nil {
		t.Fatal(err)
	}
	if err := Write(path, []byte("second")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "second" {
		t.Fatalf("contents = %q, %v", data, err)
	}
}

func TestWriteAndCheckPrivateReportFilesystemErrors(t *testing.T) {
	parentFile := filepath.Join(t.TempDir(), "parent")
	if err := os.WriteFile(parentFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Write(filepath.Join(parentFile, "credentials.json"), []byte("secret")); err == nil {
		t.Fatal("expected parent directory error")
	}
	if err := Write(t.TempDir(), []byte("secret")); err == nil {
		t.Fatal("expected directory write error")
	}
	if err := CheckPrivate(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("expected missing file error")
	}
	ordinary := filepath.Join(t.TempDir(), "ordinary")
	if err := os.WriteFile(ordinary, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := CheckPrivate(ordinary); err == nil {
		t.Fatal("expected inherited or broad permissions to be rejected")
	}
}
