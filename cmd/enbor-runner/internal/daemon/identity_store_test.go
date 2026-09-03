package daemon

import (
	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIdentityStoreUsesStateDirAndMachineID(t *testing.T) {
	stateDir := t.TempDir()
	workDir := t.TempDir()
	config := runnerconfig.Config{
		APIServer:     "https://ama.example.test",
		ProjectID:     "project_1",
		EnvironmentID: "env_1",
		StateDir:      stateDir,
		WorkDir:       workDir,
	}
	store := IdentityStore{Config: config}

	machineID, err := store.EnsureMachineID()
	if err != nil {
		t.Fatalf("expected machine id, got %v", err)
	}
	if !strings.HasPrefix(machineID, "machine_") {
		t.Fatalf("unexpected machine id %q", machineID)
	}
	if err := store.StoreRunnerID("runner_1"); err != nil {
		t.Fatalf("expected runner id store success, got %v", err)
	}
	loadedRunnerID, err := store.LoadRunnerID()
	if err != nil {
		t.Fatalf("expected runner id load success, got %v", err)
	}
	if loadedRunnerID != "runner_1" {
		t.Fatalf("expected stored runner id, got %q", loadedRunnerID)
	}
	reloadedMachineID, err := store.EnsureMachineID()
	if err != nil {
		t.Fatalf("expected machine id reload success, got %v", err)
	}
	if reloadedMachineID != machineID {
		t.Fatalf("expected stable machine id %q, got %q", machineID, reloadedMachineID)
	}
	if _, err := os.Stat(filepath.Join(workDir, stateFileName)); !os.IsNotExist(err) {
		t.Fatalf("runner state should not be written to workdir, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(stateDir, stateFileName)); err != nil {
		t.Fatalf("expected runner state in state dir, got %v", err)
	}
	if err := store.StoreRunnerID("runner_updated"); err != nil {
		t.Fatalf("expected runner id replacement success, got %v", err)
	}
	if got, err := store.LoadRunnerID(); err != nil || got != "runner_updated" {
		t.Fatalf("expected replaced runner id, got id=%q err=%v", got, err)
	}
}

func TestIdentityStoreClearsOnlyCurrentBinding(t *testing.T) {
	stateDir := t.TempDir()
	base := runnerconfig.Config{
		APIServer:     "https://ama.example.test",
		ProjectID:     "project_1",
		EnvironmentID: "env_1",
		StateDir:      stateDir,
		WorkDir:       t.TempDir(),
	}
	first := IdentityStore{Config: base}
	secondConfig := base
	secondConfig.EnvironmentID = "env_2"
	second := IdentityStore{Config: secondConfig}

	if err := first.StoreRunnerID("runner_1"); err != nil {
		t.Fatalf("store first runner id: %v", err)
	}
	if err := second.StoreRunnerID("runner_2"); err != nil {
		t.Fatalf("store second runner id: %v", err)
	}
	if err := first.ClearRunnerID(); err != nil {
		t.Fatalf("clear first runner id: %v", err)
	}

	if got, err := first.LoadRunnerID(); err != nil || got != "" {
		t.Fatalf("expected first binding cleared, got id=%q err=%v", got, err)
	}
	if got, err := second.LoadRunnerID(); err != nil || got != "runner_2" {
		t.Fatalf("expected second binding preserved, got id=%q err=%v", got, err)
	}
}

func TestIdentityStoreRejectsEmptyRunnerIDAndInvalidState(t *testing.T) {
	store := IdentityStore{Config: runnerconfig.Config{StateDir: t.TempDir()}}
	if err := store.StoreRunnerID(" "); err == nil {
		t.Fatal("expected empty runner id to fail")
	}
	if err := os.WriteFile(filepath.Join(store.Config.StateDir, stateFileName), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.LoadRunnerID(); err == nil {
		t.Fatal("expected invalid state file to fail")
	}
}

func TestIdentityStoreReturnsFilesystemErrors(t *testing.T) {
	stateDirFile := filepath.Join(t.TempDir(), "state-file")
	if err := os.WriteFile(stateDirFile, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := IdentityStore{Config: runnerconfig.Config{StateDir: stateDirFile}}
	if _, err := store.EnsureMachineID(); err == nil {
		t.Fatal("expected machine id save to fail when state dir is a file")
	}
	if err := store.ClearRunnerID(); err == nil {
		t.Fatal("expected clear runner id to fail when state dir is a file")
	}
}
