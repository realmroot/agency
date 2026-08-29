package managed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kardianos/service"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/daemon"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/instance"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
)

const (
	serviceNamePrefix  = "ama-runner-"
	runtimeStateFile   = "runtime.json"
	serviceLogFile     = "runner.log"
	defaultWaitTimeout = 30 * time.Second
)

type nativeService interface {
	Run() error
	Start() error
	Stop() error
	Restart() error
	Install() error
	Uninstall() error
	Status() (service.Status, error)
}

type serviceFactory func(service.Interface, *service.Config) (nativeService, error)

type Controller struct {
	Registry       instance.Registry
	Build          version.Info
	Executable     string
	WaitTimeout    time.Duration
	newService     serviceFactory
	exitServiceRun func(int)
}

type Status struct {
	ID             string    `json:"id"`
	APIServer      string    `json:"apiServer"`
	ProjectID      string    `json:"projectId,omitempty"`
	EnvironmentID  string    `json:"environmentId"`
	LocalState     string    `json:"localState"`
	ControlState   string    `json:"controlPlaneState"`
	PID            int       `json:"pid,omitempty"`
	RunnerID       string    `json:"runnerId,omitempty"`
	StartedAt      time.Time `json:"startedAt,omitempty"`
	ReadyAt        time.Time `json:"readyAt,omitempty"`
	StateDir       string    `json:"stateDir"`
	WorkDir        string    `json:"workDir"`
	ServiceManager string    `json:"serviceManager,omitempty"`
}

type runtimeState struct {
	PID       int       `json:"pid"`
	Phase     string    `json:"phase"`
	RunnerID  string    `json:"runnerId"`
	StartedAt time.Time `json:"startedAt"`
	ReadyAt   time.Time `json:"readyAt"`
}

func (c *Controller) IsRunning(record instance.Record) (bool, error) {
	managedService, err := c.service(record, noopProgram{})
	if err != nil {
		return false, err
	}
	status, err := managedService.Status()
	if errors.Is(err, service.ErrNotInstalled) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == service.StatusRunning, nil
}

func NewController(registry instance.Registry, build version.Info) (*Controller, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return &Controller{
		Registry:    registry,
		Build:       build.Normalized(),
		Executable:  executable,
		WaitTimeout: defaultWaitTimeout,
		newService: func(program service.Interface, config *service.Config) (nativeService, error) {
			return service.New(program, config)
		},
		exitServiceRun: os.Exit,
	}, nil
}

func (c *Controller) Start(record instance.Record) error {
	if err := os.MkdirAll(filepath.Join(record.Config.StateDir, "logs"), 0o700); err != nil {
		return err
	}
	managedService, err := c.service(record, noopProgram{})
	if err != nil {
		return err
	}
	status, err := managedService.Status()
	if err != nil && !errors.Is(err, service.ErrNotInstalled) {
		return err
	}
	if errors.Is(err, service.ErrNotInstalled) {
		if err := managedService.Install(); err != nil {
			return fmt.Errorf("install runner instance %s: %w", record.ID, err)
		}
		status = service.StatusStopped
	}
	if status == service.StatusRunning {
		return c.waitReady(record)
	}
	if err := managedService.Start(); err != nil {
		return fmt.Errorf("start runner instance %s: %w", record.ID, err)
	}
	return c.waitReady(record)
}

func (c *Controller) Stop(record instance.Record, force bool) error {
	managedService, err := c.service(record, noopProgram{})
	if err != nil {
		return err
	}
	status, statusErr := managedService.Status()
	if statusErr != nil && !errors.Is(statusErr, service.ErrNotInstalled) {
		return statusErr
	}
	if statusErr == nil && status == service.StatusRunning {
		if err := managedService.Stop(); err != nil {
			return fmt.Errorf("stop runner instance %s: %w", record.ID, err)
		}
		if err := c.waitStopped(record); err != nil {
			if !force {
				return err
			}
			state, stateErr := readRuntimeState(record.Config.StateDir)
			if stateErr != nil {
				return fmt.Errorf("force stop runner instance %s: %w", record.ID, stateErr)
			}
			if err := killProcess(state.PID); err != nil {
				return fmt.Errorf("force stop runner instance %s: %w", record.ID, err)
			}
		}
	}
	if statusErr == nil {
		if err := managedService.Uninstall(); err != nil && !errors.Is(err, service.ErrNotInstalled) {
			return fmt.Errorf("disable runner instance %s: %w", record.ID, err)
		}
	}
	return nil
}

func (c *Controller) Restart(record instance.Record) error {
	managedService, err := c.service(record, noopProgram{})
	if err != nil {
		return err
	}
	status, statusErr := managedService.Status()
	if errors.Is(statusErr, service.ErrNotInstalled) || status == service.StatusStopped {
		return c.Start(record)
	}
	if statusErr != nil {
		return statusErr
	}
	restartedAt := time.Now().UTC()
	if err := managedService.Restart(); err != nil {
		return fmt.Errorf("restart runner instance %s: %w", record.ID, err)
	}
	return c.waitReadyAfter(record, restartedAt)
}

func (c *Controller) Status(ctx context.Context, record instance.Record) Status {
	result := Status{
		ID: record.ID, APIServer: record.Config.APIServer, ProjectID: record.Config.ProjectID,
		EnvironmentID: record.Config.EnvironmentID, LocalState: "stopped", ControlState: "unknown",
		StateDir: record.Config.StateDir, WorkDir: record.Config.WorkDir,
	}
	managedService, err := c.service(record, noopProgram{})
	if err == nil {
		result.ServiceManager = service.Platform()
		nativeStatus, statusErr := managedService.Status()
		switch {
		case statusErr == nil && nativeStatus == service.StatusRunning:
			result.LocalState = "starting"
		case statusErr == nil && nativeStatus == service.StatusStopped:
			result.LocalState = "stopped"
		case errors.Is(statusErr, service.ErrNotInstalled):
			result.LocalState = "stopped"
		default:
			result.LocalState = "unknown"
		}
	}
	state, stateErr := readRuntimeState(record.Config.StateDir)
	if stateErr == nil {
		result.RunnerID = state.RunnerID
		if result.LocalState != "stopped" {
			result.PID = state.PID
			result.StartedAt = state.StartedAt
			result.ReadyAt = state.ReadyAt
			if state.Phase == "starting" || state.Phase == "ready" {
				result.LocalState = state.Phase
			}
		}
	}
	if result.RunnerID == "" {
		identity := daemon.IdentityStore{Config: record.RuntimeConfig()}
		result.RunnerID, _ = identity.LoadRunnerID()
	}
	result.ControlState = c.controlState(ctx, record, result.RunnerID)
	return result
}

func (c *Controller) RunService(record instance.Record) error {
	if err := os.MkdirAll(filepath.Join(record.Config.StateDir, "logs"), 0o700); err != nil {
		return err
	}
	program := &runnerProgram{record: record, build: c.Build, done: make(chan struct{}), exit: c.exitServiceRun}
	managedService, err := c.service(record, program)
	if err != nil {
		return err
	}
	return managedService.Run()
}

func (c *Controller) LogPath(record instance.Record) string {
	return filepath.Join(record.Config.StateDir, "logs", serviceLogFile)
}

func (c *Controller) service(record instance.Record, program service.Interface) (nativeService, error) {
	logDir := filepath.Join(record.Config.StateDir, "logs")
	environment := map[string]string{}
	for _, name := range []string{"PATH", "XDG_STATE_HOME"} {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			environment[name] = value
		}
	}
	return c.newService(program, &service.Config{
		Name:        serviceNamePrefix + strings.TrimPrefix(record.ID, "runner_"),
		DisplayName: "AMA Runner " + record.ID,
		Description: "Any Managed Agents runner for " + record.Config.EnvironmentID,
		Executable:  c.Executable,
		Arguments:   []string{"service-run", record.ID, "--registry-dir", c.Registry.Dir},
		EnvVars:     environment,
		Option: service.KeyValue{
			"UserService":  true,
			"KeepAlive":    true,
			"RunAtLoad":    true,
			"LogOutput":    true,
			"LogDirectory": logDir,
			"Restart":      "on-failure",
			"StartType":    "automatic",
			"OnFailure":    "restart",
		},
	})
}

func (c *Controller) waitReady(record instance.Record) error {
	return c.waitReadyAfter(record, time.Time{})
}

func (c *Controller) waitReadyAfter(record instance.Record, after time.Time) error {
	deadline := time.Now().Add(c.waitTimeout())
	for time.Now().Before(deadline) {
		state, err := readRuntimeState(record.Config.StateDir)
		if err == nil && state.Phase == "ready" && (after.IsZero() || state.ReadyAt.After(after)) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("runner instance %s did not become ready within %s; inspect ama-runner logs %s", record.ID, c.waitTimeout(), record.ID)
}

func (c *Controller) waitStopped(record instance.Record) error {
	deadline := time.Now().Add(c.waitTimeout())
	path := filepath.Join(record.Config.StateDir, runtimeStateFile)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("runner instance %s did not stop within %s", record.ID, c.waitTimeout())
}

func (c *Controller) waitTimeout() time.Duration {
	if c.WaitTimeout > 0 {
		return c.WaitTimeout
	}
	return defaultWaitTimeout
}

func (c *Controller) controlState(ctx context.Context, record instance.Record, runnerID string) string {
	if runnerID == "" {
		return "unregistered"
	}
	process, err := daemon.New(record.RuntimeConfig(), c.Build)
	if err != nil {
		return "unknown"
	}
	remote, err := process.Client.Runners.Get(ctx, runnerID)
	if err != nil {
		return "unknown"
	}
	return string(remote.State)
}

func readRuntimeState(stateDir string) (runtimeState, error) {
	data, err := os.ReadFile(filepath.Join(stateDir, runtimeStateFile))
	if err != nil {
		return runtimeState{}, err
	}
	var state runtimeState
	if err := json.Unmarshal(data, &state); err != nil {
		return runtimeState{}, err
	}
	return state, nil
}

type runnerProgram struct {
	record instance.Record
	build  version.Info
	run    func(context.Context) error
	cancel context.CancelFunc
	done   chan struct{}
	exit   func(int)
	mu     sync.Mutex
}

func (p *runnerProgram) Start(_ service.Service) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	logPath := filepath.Join(p.record.Config.StateDir, "logs", serviceLogFile)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(logFile, nil)))
	run := p.run
	if run == nil {
		process, err := daemon.New(p.record.RuntimeConfig(), p.build)
		if err != nil {
			_ = logFile.Close()
			return err
		}
		run = process.Start
	}
	go func() {
		defer close(p.done)
		defer logFile.Close()
		if err := run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("runner service stopped unexpectedly", "error", err)
			p.exit(1)
		}
	}()
	return nil
}

func (p *runnerProgram) Stop(_ service.Service) error {
	p.mu.Lock()
	cancel := p.cancel
	p.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	select {
	case <-p.done:
	case <-time.After(p.record.Config.ShutdownGraceInterval + 15*time.Second):
		return fmt.Errorf("runner shutdown timed out")
	}
	return nil
}

type noopProgram struct{}

func (noopProgram) Start(service.Service) error { return nil }
func (noopProgram) Stop(service.Service) error  { return nil }

func CopyLogs(ctx context.Context, path string, follow bool, output io.Writer) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := io.Copy(output, file); err != nil {
		return err
	}
	if !follow {
		return nil
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if _, err := io.Copy(output, file); err != nil {
				return err
			}
		}
	}
}
