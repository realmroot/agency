package instance

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
)

// [spec: runners/local-instances]
func TestRegistryKeepsOneRecordPerAPIServerAndEnvironment(t *testing.T) {
	stateRoot := filepath.Join(t.TempDir(), "state")
	configRoot := filepath.Join(t.TempDir(), "config")
	t.Setenv("XDG_STATE_HOME", stateRoot)
	t.Setenv("LOCALAPPDATA", stateRoot)
	t.Setenv("XDG_CONFIG_HOME", configRoot)
	t.Setenv("APPDATA", configRoot)

	registry := DefaultRegistry()
	first := newTestRecord(t, "https://ama.example.test", "env_1")
	second := newTestRecord(t, "https://ama.example.test", "env_2")
	if first.ID == second.ID || first.Config.StateDir == second.Config.StateDir {
		t.Fatalf("instances are not isolated: first=%#v second=%#v", first, second)
	}
	if err := registry.Create(first); err != nil {
		t.Fatal(err)
	}
	if err := registry.Create(first); err == nil {
		t.Fatal("duplicate instance creation must fail")
	}
	if err := registry.Create(second); err != nil {
		t.Fatal(err)
	}
	records, err := registry.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || records[0].ID == records[1].ID {
		t.Fatalf("unexpected registry records %#v", records)
	}
	loaded, err := registry.Get(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.RuntimeConfig().CredentialPath != first.CredentialPath || loaded.Config.ConfigPath != "" {
		t.Fatalf("managed runtime paths were not restored: %#v", loaded)
	}
	if loaded.StartAtLogin {
		t.Fatal("new instance must default to disabled login startup")
	}
	loaded.StartAtLogin = true
	loaded.Config.MaxConcurrent = 3
	if err := registry.Put(loaded); err != nil {
		t.Fatal(err)
	}
	updated, err := registry.Get(first.ID)
	if err != nil || updated.Config.MaxConcurrent != 3 || !updated.StartAtLogin || !updated.UpdatedAt.After(updated.CreatedAt) {
		t.Fatalf("instance update was not persisted: %#v err=%v", updated, err)
	}
	if err := registry.Remove(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Get(first.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("removed instance is still readable: %v", err)
	}
}

func TestRegistryRejectsTamperedAndUnsafeRecords(t *testing.T) {
	registry := Registry{Dir: t.TempDir()}
	record := newTestRecord(t, "https://ama.example.test", "env_1")
	record.ID = "runner_0000000000000000"
	if err := registry.Create(record); err == nil {
		t.Fatal("tampered instance id must fail")
	}
	if _, err := registry.Get("../runner_bad"); err == nil {
		t.Fatal("unsafe instance id must fail")
	}
	if err := os.WriteFile(filepath.Join(registry.Dir, "runner_bad.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Get("runner_bad"); err == nil {
		t.Fatal("invalid record must fail")
	}
	if err := os.WriteFile(filepath.Join(registry.Dir, "runner_broken.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.Get("runner_broken"); err == nil {
		t.Fatal("malformed record must fail")
	}
	if err := (Registry{}).Create(newTestRecord(t, "https://ama.example.test", "env_2")); err == nil {
		t.Fatal("empty registry directory must fail")
	}
	if err := registry.Remove("runner_missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing remove must return ErrNotFound, got %v", err)
	}
	badVersion := newTestRecord(t, "https://ama.example.test", "env_3")
	badVersion.Version = 1
	if err := registry.Create(badVersion); err == nil {
		t.Fatal("unsupported instance schema must fail")
	}
	missingCredential := newTestRecord(t, "https://ama.example.test", "env_4")
	missingCredential.CredentialPath = ""
	if err := registry.Create(missingCredential); err == nil {
		t.Fatal("missing credential reference must fail")
	}
	missingAccount := newTestRecord(t, "https://ama.example.test", "env_6")
	missingAccount.AccountID = ""
	if err := registry.Create(missingAccount); err == nil {
		t.Fatal("missing account reference must fail")
	}
	customStorage := newTestRecord(t, "https://ama.example.test", "env_5")
	customStorage.Config.StateDir = t.TempDir()
	customStorage.Config.WorkDir = filepath.Join(customStorage.Config.StateDir, "work")
	if err := registry.Create(customStorage); err == nil {
		t.Fatal("managed instance custom storage must fail")
	}
}

func TestInstanceIDNormalizesServerAndIncludesEnvironment(t *testing.T) {
	first, err := runnerconfig.InstanceID("https://AMA.example.test/", "env_1")
	if err != nil {
		t.Fatal(err)
	}
	normalized, err := runnerconfig.InstanceID("https://ama.example.test", "env_1")
	if err != nil {
		t.Fatal(err)
	}
	other, err := runnerconfig.InstanceID("https://ama.example.test", "env_2")
	if err != nil {
		t.Fatal(err)
	}
	if first != normalized || first == other {
		t.Fatalf("unexpected instance ids: %q %q %q", first, normalized, other)
	}
	if _, err := runnerconfig.InstanceID("://bad", "env_1"); err == nil {
		t.Fatal("invalid API Server must fail")
	}
	if _, err := runnerconfig.InstanceID("https://ama.example.test", ""); err == nil {
		t.Fatal("empty Environment must fail")
	}
}

func newTestRecord(t *testing.T, apiServer string, environmentID string) Record {
	t.Helper()
	stateDir, err := runnerconfig.DefaultStateDirForInstance(apiServer, environmentID)
	if err != nil {
		t.Fatal(err)
	}
	record, err := NewRecord(runnerconfig.Config{
		APIServer: apiServer, ProjectID: "project_1", EnvironmentID: environmentID,
		AllowUnsafeProcess: true, StateDir: stateDir, WorkDir: runnerconfig.DefaultWorkDirForStateDir(stateDir),
		MaxConcurrent: 1, HeartbeatInterval: 20 * time.Second, LeaseDurationSeconds: 60,
		RenewInterval: 20 * time.Second, CommandTimeout: 10 * time.Minute,
		ShutdownGraceInterval: 5 * time.Second, MaxSessionDuration: 2 * time.Hour,
		CredentialPath:      filepath.Join(t.TempDir(), "credentials.json"),
		CredentialAccountID: "acct_1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return record
}
