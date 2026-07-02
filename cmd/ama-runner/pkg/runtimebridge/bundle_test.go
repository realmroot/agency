package runtimebridge

import (
	"os"
	"strings"
	"testing"
)

func TestMaterializeWritesEmbeddedBundle(t *testing.T) {
	cacheRoot := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", cacheRoot)
	t.Setenv("HOME", cacheRoot)
	path, err := Materialize()
	if err != nil {
		t.Fatalf("expected embedded bridge to materialize, got %v", err)
	}
	if !strings.HasSuffix(path, ".mjs") {
		t.Fatalf("expected bridge bundle path, got %q", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(Bytes()) {
		t.Fatal("expected materialized bridge to match embedded bundle")
	}
	cached, err := Materialize()
	if err != nil {
		t.Fatalf("expected cached embedded bridge to materialize, got %v", err)
	}
	if cached != path {
		t.Fatalf("expected stable materialized path, got %q then %q", path, cached)
	}
}

func TestMaterializeReturnsCacheDirectoryError(t *testing.T) {
	cacheFile := t.TempDir() + "/cache-file"
	if err := os.WriteFile(cacheFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_CACHE_HOME", cacheFile)
	t.Setenv("HOME", cacheFile)
	if _, err := Materialize(); err == nil {
		t.Fatal("expected cache directory error")
	}
}

func TestMaterializeFallsBackToTempDirWithoutUserCacheDir(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", "")
	t.Setenv("HOME", "")
	path, err := Materialize()
	if err != nil {
		t.Fatalf("expected temp dir fallback, got %v", err)
	}
	if !strings.HasPrefix(path, os.TempDir()) {
		t.Fatalf("expected temp dir path, got %q", path)
	}
}

func TestBytesReturnsCopy(t *testing.T) {
	first := Bytes()
	first[0] = 0
	second := Bytes()
	if second[0] == 0 {
		t.Fatal("expected Bytes to return a copy")
	}
}

func TestEmbeddedBundleUsesCanonicalWorkspaceHomeEnv(t *testing.T) {
	bundle := string(Bytes())
	for _, expected := range []string{"AMA_WORKSPACE_HOME", "GH_CONFIG_DIR", "GIT_CONFIG_GLOBAL"} {
		if !strings.Contains(bundle, expected) {
			t.Fatalf("expected embedded bridge bundle to contain %q", expected)
		}
	}
	if strings.Contains(bundle, "AMA_RUNTIME_BRIDGE_SESSION_HOME") {
		t.Fatal("embedded bridge bundle still contains deprecated session home env")
	}
}
