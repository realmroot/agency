package daemon

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runnerconfig "github.com/realmroot/enbor/cmd/enbor-runner/internal/config"
	"github.com/samber/lo"
)

const stateFileName = "runner-state.json"

type IdentityStore struct {
	Config runnerconfig.Config
}

type identityState struct {
	MachineID string            `json:"machineId"`
	Bindings  []identityBinding `json:"bindings"`
}

type identityBinding struct {
	Key         string `json:"key"`
	APIServer   string `json:"apiServer"`
	Project     string `json:"projectId,omitempty"`
	Environment string `json:"environmentId,omitempty"`
	MachineID   string `json:"machineId"`
	Hostname    string `json:"hostname"`
	RunnerID    string `json:"runnerId"`
}

func (s IdentityStore) EnsureMachineID() (string, error) {
	state, err := s.load()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(state.MachineID) != "" {
		return state.MachineID, nil
	}
	machineID, err := newMachineID()
	if err != nil {
		return "", err
	}
	state.MachineID = machineID
	if err := s.save(state); err != nil {
		return "", err
	}
	return machineID, nil
}

func (s IdentityStore) LoadRunnerID() (string, error) {
	state, err := s.load()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(state.MachineID) == "" {
		return "", nil
	}
	key := s.identityKey(state.MachineID)
	for _, binding := range state.Bindings {
		if binding.Key == key {
			return binding.RunnerID, nil
		}
	}
	return "", nil
}

func (s IdentityStore) StoreRunnerID(runnerID string) error {
	if strings.TrimSpace(runnerID) == "" {
		return fmt.Errorf("runner id is required")
	}
	machineID, err := s.EnsureMachineID()
	if err != nil {
		return err
	}
	state, err := s.load()
	if err != nil {
		return err
	}
	key := s.identityKey(machineID)
	state.MachineID = machineID
	binding := identityBinding{
		Key:         key,
		APIServer:   strings.TrimRight(s.Config.APIServer, "/"),
		Project:     s.Config.ProjectID,
		Environment: s.Config.EnvironmentID,
		MachineID:   machineID,
		Hostname:    displayName(),
		RunnerID:    runnerID,
	}
	replaced := false
	for index := range state.Bindings {
		if state.Bindings[index].Key == key {
			state.Bindings[index] = binding
			replaced = true
			break
		}
	}
	if !replaced {
		state.Bindings = append(state.Bindings, binding)
	}
	sort.Slice(state.Bindings, func(left, right int) bool {
		return state.Bindings[left].Key < state.Bindings[right].Key
	})
	return s.save(state)
}

func (s IdentityStore) ClearRunnerID() error {
	machineID, err := s.EnsureMachineID()
	if err != nil {
		return err
	}
	state, err := s.load()
	if err != nil {
		return err
	}
	key := s.identityKey(machineID)
	state.Bindings = lo.Reject(state.Bindings, func(binding identityBinding, _ int) bool {
		return binding.Key == key
	})
	return s.save(state)
}

func (s IdentityStore) path() string {
	return filepath.Join(s.Config.StateDir, stateFileName)
}

func (s IdentityStore) identityKey(machineID string) string {
	parts := []string{
		strings.TrimRight(s.Config.APIServer, "/"),
		s.Config.ProjectID,
		s.Config.EnvironmentID,
		machineID,
	}
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(hash[:])
}

func (s IdentityStore) load() (identityState, error) {
	data, err := os.ReadFile(s.path())
	if err != nil {
		if os.IsNotExist(err) {
			return identityState{}, nil
		}
		return identityState{}, err
	}
	var state identityState
	if err := json.Unmarshal(data, &state); err != nil {
		return identityState{}, err
	}
	return state, nil
}

func (s IdentityStore) save(state identityState) error {
	if err := os.MkdirAll(filepath.Dir(s.path()), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(s.path(), data, 0o600)
}

func displayName() string {
	hostname, err := os.Hostname()
	if err == nil && strings.TrimSpace(hostname) != "" {
		return hostname
	}
	return "ama-runner"
}

func newMachineID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return "machine_" + hex.EncodeToString(bytes[:]), nil
}
