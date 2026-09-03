package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/realmroot/enbor/cmd/enbor-runner/internal/sys/securefile"
)

const runtimeStateFileName = "runtime.json"

type runtimeState struct {
	PID           int       `json:"pid"`
	Phase         string    `json:"phase"`
	RunnerID      string    `json:"runnerId,omitempty"`
	StartedAt     time.Time `json:"startedAt"`
	ReadyAt       time.Time `json:"readyAt,omitempty"`
	Version       string    `json:"version"`
	EnvironmentID string    `json:"environmentId"`
}

func (d *Daemon) writeRuntimeState(phase string, startedAt time.Time, readyAt time.Time) error {
	state := runtimeState{
		PID:           os.Getpid(),
		Phase:         phase,
		RunnerID:      d.RunnerID,
		StartedAt:     startedAt,
		ReadyAt:       readyAt,
		Version:       d.buildInfo().Version,
		EnvironmentID: d.Config.EnvironmentID,
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return securefile.Write(filepath.Join(d.Config.StateDir, runtimeStateFileName), append(data, '\n'))
}

func (d *Daemon) removeRuntimeState() {
	_ = os.Remove(filepath.Join(d.Config.StateDir, runtimeStateFileName))
}
