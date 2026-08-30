package managed

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kardianos/service"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/instance"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
)

type fakeService struct {
	status       service.Status
	statusErr    error
	installed    bool
	started      int
	stopped      int
	restarted    int
	uninstalled  int
	ran          int
	onStart      func()
	onStop       func()
	onRestart    func()
	startErr     error
	stopErr      error
	restartErr   error
	installErr   error
	uninstallErr error
}

func (f *fakeService) Run() error {
	f.ran++
	return nil
}
func (f *fakeService) Start() error {
	f.started++
	if f.startErr != nil {
		return f.startErr
	}
	f.status = service.StatusRunning
	f.statusErr = nil
	if f.onStart != nil {
		f.onStart()
	}
	return nil
}
func (f *fakeService) Stop() error {
	f.stopped++
	if f.stopErr != nil {
		return f.stopErr
	}
	f.status = service.StatusStopped
	if f.onStop != nil {
		f.onStop()
	}
	return nil
}
func (f *fakeService) Restart() error {
	f.restarted++
	if f.restartErr != nil {
		return f.restartErr
	}
	if f.onRestart != nil {
		f.onRestart()
	}
	return nil
}
func (f *fakeService) Install() error {
	if f.installErr != nil {
		return f.installErr
	}
	f.installed = true
	f.status = service.StatusStopped
	f.statusErr = nil
	return nil
}
func (f *fakeService) Uninstall() error {
	f.uninstalled++
	if f.uninstallErr != nil {
		return f.uninstallErr
	}
	f.statusErr = service.ErrNotInstalled
	return nil
}
func (f *fakeService) Status() (service.Status, error) { return f.status, f.statusErr }

// [spec: runners/local-instances]
func TestControllerStartsStopsAndRestartsAReadyInstance(t *testing.T) {
	record := managedTestRecord(t)
	serviceState := &fakeService{statusErr: service.ErrNotInstalled}
	controller := managedTestController(record, serviceState)
	serviceState.onStart = func() { writeManagedTestRuntime(t, record, "ready", time.Now().UTC()) }
	serviceState.onStop = func() { _ = os.Remove(filepath.Join(record.Config.StateDir, runtimeStateFile)) }
	serviceState.onRestart = func() { writeManagedTestRuntime(t, record, "ready", time.Now().UTC().Add(time.Second)) }

	if err := controller.Start(record); err != nil {
		t.Fatal(err)
	}
	if !serviceState.installed || serviceState.started != 1 {
		t.Fatalf("service was not installed and started: %#v", serviceState)
	}
	if err := controller.Start(record); err != nil {
		t.Fatal(err)
	}
	if serviceState.started != 1 {
		t.Fatal("already-running service must not be started twice")
	}
	status := controller.Status(context.Background(), record)
	if status.LocalState != "ready" || status.PID != 42 || status.ControlState != "unregistered" {
		t.Fatalf("unexpected status %#v", status)
	}
	if err := controller.Restart(record); err != nil {
		t.Fatal(err)
	}
	if serviceState.restarted != 1 {
		t.Fatalf("service was not restarted: %#v", serviceState)
	}
	if err := controller.Stop(record, false); err != nil {
		t.Fatal(err)
	}
	if serviceState.stopped != 1 || serviceState.uninstalled != 1 {
		t.Fatalf("service was not stopped and disabled: %#v", serviceState)
	}
}

func TestControllerTimesOutWhenServiceNeverBecomesReady(t *testing.T) {
	record := managedTestRecord(t)
	serviceState := &fakeService{statusErr: service.ErrNotInstalled}
	controller := managedTestController(record, serviceState)
	controller.WaitTimeout = time.Millisecond
	if err := controller.Start(record); err == nil {
		t.Fatal("start without readiness must fail")
	}
}

func TestNewControllerUsesCurrentExecutableAndDefaults(t *testing.T) {
	registry := instance.Registry{Dir: t.TempDir()}
	controller, err := NewController(registry, version.Info{})
	if err != nil {
		t.Fatal(err)
	}
	if controller.Executable == "" || controller.Registry.Dir != registry.Dir || controller.WaitTimeout != defaultWaitTimeout {
		t.Fatalf("unexpected controller %#v", controller)
	}
}

// [spec: runners/local-instances]
func TestControllerConfiguresServiceLoginStartupPolicy(t *testing.T) {
	for _, test := range []struct {
		name         string
		startAtLogin bool
		startType    string
	}{
		{name: "disabled by default", startAtLogin: false, startType: "manual"},
		{name: "explicitly enabled", startAtLogin: true, startType: "automatic"},
	} {
		t.Run(test.name, func(t *testing.T) {
			record := managedTestRecord(t)
			record.StartAtLogin = test.startAtLogin
			var captured *service.Config
			controller := &Controller{
				Registry:   instance.Registry{Dir: t.TempDir()},
				Executable: "/tmp/ama-runner",
				newService: func(_ service.Interface, config *service.Config) (nativeService, error) {
					captured = config
					return &fakeService{statusErr: service.ErrNotInstalled}, nil
				},
			}

			status := controller.Status(context.Background(), record)
			if captured == nil {
				t.Fatal("service configuration was not created")
			}
			if captured.Option["RunAtLoad"] != test.startAtLogin || captured.Option["KeepAlive"] != test.startAtLogin || captured.Option["StartType"] != test.startType {
				t.Fatalf("unexpected login startup service options: %#v", captured.Option)
			}
			if status.StartAtLogin != test.startAtLogin {
				t.Fatalf("status did not preserve login startup policy: %#v", status)
			}
		})
	}
}

// [spec: runners/local-instances]
func TestControllerUpdatesLoginStartupWithoutChangingServiceState(t *testing.T) {
	for _, status := range []service.Status{service.StatusRunning, service.StatusStopped} {
		t.Run(fmt.Sprintf("status=%d", status), func(t *testing.T) {
			record := managedTestRecord(t)
			record.StartAtLogin = false
			native := &fakeService{status: status}
			controller := managedTestController(record, native)
			var name string
			var enabled bool
			rollbackCalled := false
			controller.updateStartAtLogin = func(serviceName string, newValue bool) (func() error, error) {
				name, enabled = serviceName, newValue
				return func() error {
					rollbackCalled = true
					return nil
				}, nil
			}

			rollback, err := controller.SetStartAtLogin(record, true)
			if err != nil {
				t.Fatal(err)
			}
			if name != serviceNamePrefix+strings.TrimPrefix(record.ID, "runner_") || !enabled {
				t.Fatalf("unexpected native policy update: name=%q enabled=%t", name, enabled)
			}
			if rollback == nil {
				t.Fatal("native policy update did not return its rollback")
			}
			if err := rollback(); err != nil || !rollbackCalled {
				t.Fatalf("controller did not pass through updater rollback: called=%t err=%v", rollbackCalled, err)
			}
			if native.started != 0 || native.stopped != 0 || native.restarted != 0 || native.uninstalled != 0 {
				t.Fatalf("policy update changed service state: %#v", native)
			}
		})
	}
}

func TestControllerLoginStartupUpdateBoundaries(t *testing.T) {
	record := managedTestRecord(t)

	t.Run("service creation failure", func(t *testing.T) {
		failure := errors.New("service creation failed")
		controller := &Controller{
			newService: func(service.Interface, *service.Config) (nativeService, error) { return nil, failure },
		}
		if _, err := controller.SetStartAtLogin(record, true); !errors.Is(err, failure) {
			t.Fatalf("expected service creation failure, got %v", err)
		}
	})

	t.Run("uninstalled service", func(t *testing.T) {
		native := &fakeService{statusErr: service.ErrNotInstalled}
		controller := managedTestController(record, native)
		updates := 0
		controller.updateStartAtLogin = func(string, bool) (func() error, error) {
			updates++
			return nil, nil
		}
		rollback, err := controller.SetStartAtLogin(record, true)
		if err != nil {
			t.Fatal(err)
		}
		if rollback == nil || rollback() != nil {
			t.Fatal("uninstalled service must return a no-op rollback")
		}
		if updates != 0 {
			t.Fatal("uninstalled service must defer login policy to persisted configuration")
		}
	})

	t.Run("native update failure", func(t *testing.T) {
		failure := errors.New("native update failed")
		controller := managedTestController(record, &fakeService{status: service.StatusRunning})
		controller.updateStartAtLogin = func(string, bool) (func() error, error) { return nil, failure }
		if _, err := controller.SetStartAtLogin(record, true); !errors.Is(err, failure) {
			t.Fatalf("expected native update failure, got %v", err)
		}
	})

	t.Run("native rollback failure", func(t *testing.T) {
		failure := errors.New("native rollback failed")
		controller := managedTestController(record, &fakeService{status: service.StatusRunning})
		controller.updateStartAtLogin = func(string, bool) (func() error, error) {
			return func() error { return failure }, nil
		}
		rollback, err := controller.SetStartAtLogin(record, true)
		if err != nil {
			t.Fatal(err)
		}
		if rollback == nil || !errors.Is(rollback(), failure) {
			t.Fatal("controller did not pass through the updater rollback failure")
		}
	})

	t.Run("service status failure", func(t *testing.T) {
		failure := errors.New("status failed")
		controller := managedTestController(record, &fakeService{statusErr: failure})
		if _, err := controller.SetStartAtLogin(record, true); !errors.Is(err, failure) {
			t.Fatalf("expected status failure, got %v", err)
		}
	})
}

// [spec: runners/local-instances]
func TestControllerAppliesLoginStartupPolicyToInstalledService(t *testing.T) {
	for _, startAtLogin := range []bool{false, true} {
		t.Run(fmt.Sprintf("startAtLogin=%t", startAtLogin), func(t *testing.T) {
			record := managedTestRecord(t)
			record.StartAtLogin = startAtLogin
			native := &fakeService{statusErr: service.ErrNotInstalled}
			native.onStart = func() { writeManagedTestRuntime(t, record, "ready", time.Now().UTC()) }
			native.onRestart = func() { writeManagedTestRuntime(t, record, "ready", time.Now().UTC().Add(time.Second)) }
			controller := managedTestController(record, native)
			var syncedName string
			var syncedPolicy bool
			controller.syncStartAtLogin = func(name string, enabled bool) error {
				syncedName = name
				syncedPolicy = enabled
				return nil
			}
			var starts []bool
			controller.startInstalledService = func(name string, enabled bool) error {
				if name != syncedName {
					t.Fatalf("installed service name changed: synced=%q started=%q", syncedName, name)
				}
				starts = append(starts, enabled)
				return nil
			}

			if err := controller.Start(record); err != nil {
				t.Fatal(err)
			}
			if syncedName != serviceNamePrefix+strings.TrimPrefix(record.ID, "runner_") || syncedPolicy != startAtLogin || len(starts) != 1 || starts[0] != startAtLogin {
				t.Fatalf("login startup policy was not applied: name=%q synced=%t starts=%v", syncedName, syncedPolicy, starts)
			}
			if err := controller.Restart(record); err != nil {
				t.Fatal(err)
			}
			if len(starts) != 2 || starts[1] != startAtLogin {
				t.Fatalf("restart did not preserve login startup policy: %v", starts)
			}
		})
	}
}

func TestControllerRollsBackPlatformLoginStartupFailures(t *testing.T) {
	record := managedTestRecord(t)

	t.Run("policy synchronization", func(t *testing.T) {
		failure := errors.New("sync login startup failed")
		native := &fakeService{statusErr: service.ErrNotInstalled}
		controller := managedTestController(record, native)
		controller.syncStartAtLogin = func(string, bool) error { return failure }

		err := controller.Start(record)
		if !errors.Is(err, failure) {
			t.Fatalf("expected synchronization failure, got %v", err)
		}
		if !native.installed || native.uninstalled != 1 || native.started != 0 {
			t.Fatalf("failed policy synchronization did not roll back installation: %#v", native)
		}
	})

	t.Run("immediate start", func(t *testing.T) {
		failure := errors.New("start installed service failed")
		native := &fakeService{statusErr: service.ErrNotInstalled}
		controller := managedTestController(record, native)
		controller.startInstalledService = func(string, bool) error { return failure }

		err := controller.Start(record)
		if !errors.Is(err, failure) {
			t.Fatalf("expected immediate start failure, got %v", err)
		}
		if native.started != 1 || native.stopped != 1 {
			t.Fatalf("failed immediate start did not stop the service: %#v", native)
		}
	})
}

func TestControllerStatusAndServiceBranches(t *testing.T) {
	record := managedTestRecord(t)
	native := &fakeService{status: service.StatusRunning}
	controller := managedTestController(record, native)

	running, err := controller.IsRunning(record)
	if err != nil || !running {
		t.Fatalf("expected running service, running=%v err=%v", running, err)
	}
	native.status = service.StatusStopped
	running, err = controller.IsRunning(record)
	if err != nil || running {
		t.Fatalf("expected stopped service, running=%v err=%v", running, err)
	}
	native.statusErr = service.ErrNotInstalled
	running, err = controller.IsRunning(record)
	if err != nil || running {
		t.Fatalf("expected uninstalled service, running=%v err=%v", running, err)
	}
	native.statusErr = errors.New("status failed")
	if _, err := controller.IsRunning(record); err == nil {
		t.Fatal("native status failure must be returned")
	}

	native.statusErr = nil
	native.status = service.StatusStopped
	if err := controller.Stop(record, false); err != nil {
		t.Fatal(err)
	}
	if native.uninstalled != 1 {
		t.Fatalf("stopped service was not disabled: %#v", native)
	}

	native.statusErr = service.ErrNotInstalled
	native.onStart = func() { writeManagedTestRuntime(t, record, "ready", time.Now().UTC()) }
	if err := controller.Restart(record); err != nil {
		t.Fatal(err)
	}
	if native.started != 1 {
		t.Fatalf("restart did not start an uninstalled instance: %#v", native)
	}

	if got := controller.LogPath(record); got != filepath.Join(record.Config.StateDir, "logs", serviceLogFile) {
		t.Fatalf("unexpected log path %q", got)
	}
	if err := controller.RunService(record); err != nil {
		t.Fatal(err)
	}
	if native.ran != 1 {
		t.Fatalf("service run was not delegated: %#v", native)
	}
}

func TestControllerReturnsNativeLifecycleFailures(t *testing.T) {
	record := managedTestRecord(t)
	failure := errors.New("native failure")

	cases := []struct {
		name   string
		native *fakeService
		run    func(*Controller) error
	}{
		{
			name:   "start status",
			native: &fakeService{statusErr: failure},
			run:    func(controller *Controller) error { return controller.Start(record) },
		},
		{
			name:   "install",
			native: &fakeService{statusErr: service.ErrNotInstalled, installErr: failure},
			run:    func(controller *Controller) error { return controller.Start(record) },
		},
		{
			name:   "start",
			native: &fakeService{status: service.StatusStopped, startErr: failure},
			run:    func(controller *Controller) error { return controller.Start(record) },
		},
		{
			name:   "stop status",
			native: &fakeService{statusErr: failure},
			run:    func(controller *Controller) error { return controller.Stop(record, false) },
		},
		{
			name:   "stop",
			native: &fakeService{status: service.StatusRunning, stopErr: failure},
			run:    func(controller *Controller) error { return controller.Stop(record, false) },
		},
		{
			name:   "uninstall",
			native: &fakeService{status: service.StatusStopped, uninstallErr: failure},
			run:    func(controller *Controller) error { return controller.Stop(record, false) },
		},
		{
			name:   "restart status",
			native: &fakeService{statusErr: failure},
			run:    func(controller *Controller) error { return controller.Restart(record) },
		},
		{
			name:   "restart",
			native: &fakeService{status: service.StatusRunning, restartErr: failure},
			run:    func(controller *Controller) error { return controller.Restart(record) },
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			controller := managedTestController(record, test.native)
			if err := test.run(controller); !errors.Is(err, failure) {
				t.Fatalf("expected native failure, got %v", err)
			}
		})
	}
}

func TestControllerStopTimesOutBeforeDisablingService(t *testing.T) {
	record := managedTestRecord(t)
	writeManagedTestRuntime(t, record, "ready", time.Now().UTC())
	native := &fakeService{status: service.StatusRunning}
	controller := managedTestController(record, native)
	controller.WaitTimeout = time.Millisecond
	if err := controller.Stop(record, false); err == nil {
		t.Fatal("stop must fail when runtime ownership does not clear")
	}
	if native.uninstalled != 0 {
		t.Fatal("timed-out Runner must not be disabled before it has stopped")
	}
}

func TestControllerForceStopRejectsInvalidRuntimePID(t *testing.T) {
	record := managedTestRecord(t)
	writeManagedTestRuntime(t, record, "ready", time.Now().UTC())
	data := []byte(`{"pid":0,"phase":"ready"}`)
	if err := os.WriteFile(filepath.Join(record.Config.StateDir, runtimeStateFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
	native := &fakeService{status: service.StatusRunning}
	controller := managedTestController(record, native)
	controller.WaitTimeout = time.Millisecond
	if err := controller.Stop(record, true); err == nil {
		t.Fatal("force stop with invalid PID must fail safely")
	}
}

func TestControllerRunServiceRejectsBlockedStateDirectory(t *testing.T) {
	record := managedTestRecord(t)
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blocked, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}
	record.Config.StateDir = blocked
	controller := managedTestController(record, &fakeService{})
	if err := controller.RunService(record); err == nil {
		t.Fatal("blocked service log directory must fail")
	}
}

func TestControllerReportsRemoteControlPlaneState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/runners/runner_remote" || request.Header.Get("authorization") != "Bearer runner-token" {
			t.Fatalf("unexpected Runner status request %s %q", request.URL.Path, request.Header.Get("authorization"))
		}
		writer.Header().Set("content-type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"runner_remote","state":"active"}`))
	}))
	defer server.Close()
	stateRoot := filepath.Join(t.TempDir(), "state")
	t.Setenv("XDG_STATE_HOME", stateRoot)
	t.Setenv("LOCALAPPDATA", stateRoot)
	stateDir, err := runnerconfig.DefaultStateDirForInstance(server.URL, "env_1")
	if err != nil {
		t.Fatal(err)
	}
	credentialPath := filepath.Join(t.TempDir(), "credentials.json")
	if err := runnerconfig.SaveCredentialProfile(credentialPath, runnerconfig.CredentialProfile{
		AccountID: "acct_1", APIServer: server.URL, AccessToken: "runner-token", TokenType: "Bearer",
	}); err != nil {
		t.Fatal(err)
	}
	record, err := instance.NewRecord(runnerconfig.Config{
		APIServer: server.URL, ProjectID: "project_1", EnvironmentID: "env_1", AllowUnsafeProcess: true,
		StateDir: stateDir, WorkDir: runnerconfig.DefaultWorkDirForStateDir(stateDir), MaxConcurrent: 1,
		HeartbeatInterval: 20 * time.Second, LeaseDurationSeconds: 60, RenewInterval: 20 * time.Second,
		CommandTimeout: 10 * time.Minute, ShutdownGraceInterval: 5 * time.Second, MaxSessionDuration: 2 * time.Hour,
		CredentialPath: credentialPath, CredentialAccountID: "acct_1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	data := []byte(`{"pid":42,"phase":"ready","runnerId":"runner_remote","startedAt":"2026-01-01T00:00:00Z","readyAt":"2026-01-01T00:00:01Z"}`)
	if err := os.WriteFile(filepath.Join(stateDir, runtimeStateFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
	native := &fakeService{status: service.StatusRunning}
	controller := managedTestController(record, native)
	status := controller.Status(context.Background(), record)
	if status.ControlState != "active" || status.RunnerID != "runner_remote" {
		t.Fatalf("unexpected remote status %#v", status)
	}
}

func TestRunnerProgramStartsAndStopsInjectedDaemon(t *testing.T) {
	record := managedTestRecord(t)
	started := make(chan struct{})
	program := &runnerProgram{
		record: record,
		done:   make(chan struct{}),
		exit:   func(int) { t.Error("canceled daemon must not exit the process") },
		run: func(ctx context.Context) error {
			close(started)
			<-ctx.Done()
			return ctx.Err()
		},
	}
	if err := program.Start(nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("program did not start")
	}
	if err := program.Stop(nil); err != nil {
		t.Fatal(err)
	}
	logData, err := os.ReadFile(filepath.Join(record.Config.StateDir, "logs", serviceLogFile))
	if err != nil {
		t.Fatal(err)
	}
	if len(logData) != 0 {
		t.Fatalf("unexpected service log %q", logData)
	}
}

func TestRunnerProgramReportsUnexpectedDaemonFailure(t *testing.T) {
	record := managedTestRecord(t)
	exitCode := make(chan int, 1)
	program := &runnerProgram{
		record: record,
		done:   make(chan struct{}),
		exit:   func(code int) { exitCode <- code },
		run:    func(context.Context) error { return fmt.Errorf("daemon failed") },
	}
	if err := program.Start(nil); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-exitCode:
		if code != 1 {
			t.Fatalf("unexpected exit code %d", code)
		}
	case <-time.After(time.Second):
		t.Fatal("unexpected daemon failure did not request process exit")
	}
}

func TestRunnerProgramRejectsMissingRuntimeCredentials(t *testing.T) {
	record := managedTestRecord(t)
	record.CredentialPath = filepath.Join(t.TempDir(), "missing-credentials.json")
	program := &runnerProgram{record: record, done: make(chan struct{}), exit: func(int) {}}
	if err := program.Start(nil); err == nil {
		t.Fatal("service program without saved credentials must fail")
	}
	if err := (noopProgram{}).Start(nil); err != nil {
		t.Fatal(err)
	}
	if err := (noopProgram{}).Stop(nil); err != nil {
		t.Fatal(err)
	}
	if err := killProcess(0); err == nil {
		t.Fatal("invalid process id must fail")
	}
}

func TestCopyLogsReadsAndFollowsRunnerLog(t *testing.T) {
	if err := CopyLogs(context.Background(), filepath.Join(t.TempDir(), "missing.log"), false, &bytes.Buffer{}); err == nil {
		t.Fatal("missing log file must fail")
	}
	path := filepath.Join(t.TempDir(), "runner.log")
	if err := os.WriteFile(path, []byte("first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := CopyLogs(context.Background(), path, false, &output); err != nil {
		t.Fatal(err)
	}
	if output.String() != "first\n" {
		t.Fatalf("unexpected log output %q", output.String())
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- CopyLogs(ctx, path, true, &output) }()
	time.Sleep(20 * time.Millisecond)
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.WriteString("second\n")
	_ = file.Close()
	time.Sleep(300 * time.Millisecond)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected follow result %v", err)
	}
	if output.String() != "first\nfirst\nsecond\n" {
		t.Fatalf("unexpected followed output %q", output.String())
	}
}

func TestManagedRuntimeHelpersRejectInvalidState(t *testing.T) {
	controller := &Controller{}
	if controller.waitTimeout() != defaultWaitTimeout {
		t.Fatalf("unexpected default wait timeout %s", controller.waitTimeout())
	}
	stateDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(stateDir, runtimeStateFile), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readRuntimeState(stateDir); err == nil {
		t.Fatal("invalid runtime state must fail")
	}
}

func managedTestController(record instance.Record, native *fakeService) *Controller {
	return &Controller{
		Registry:              instance.Registry{Dir: filepath.Dir(record.Config.StateDir)},
		WaitTimeout:           time.Second,
		newService:            func(service.Interface, *service.Config) (nativeService, error) { return native, nil },
		exitServiceRun:        func(int) {},
		syncStartAtLogin:      func(string, bool) error { return nil },
		startInstalledService: func(string, bool) error { return nil },
		updateStartAtLogin:    func(string, bool) (func() error, error) { return func() error { return nil }, nil },
	}
}

func managedTestRecord(t *testing.T) instance.Record {
	t.Helper()
	stateRoot := filepath.Join(t.TempDir(), "state")
	t.Setenv("XDG_STATE_HOME", stateRoot)
	t.Setenv("LOCALAPPDATA", stateRoot)
	stateDir, err := runnerconfig.DefaultStateDirForInstance("https://ama.example.test", "env_1")
	if err != nil {
		t.Fatal(err)
	}
	record, err := instance.NewRecord(runnerconfig.Config{
		APIServer: "https://ama.example.test", ProjectID: "project_1", EnvironmentID: "env_1",
		AllowUnsafeProcess: true, StateDir: stateDir, WorkDir: runnerconfig.DefaultWorkDirForStateDir(stateDir),
		MaxConcurrent: 1, HeartbeatInterval: 20 * time.Second, LeaseDurationSeconds: 60,
		RenewInterval: 20 * time.Second, CommandTimeout: 10 * time.Minute,
		ShutdownGraceInterval: 5 * time.Second, MaxSessionDuration: 2 * time.Hour,
		CredentialPath: filepath.Join(t.TempDir(), "credentials.json"), CredentialAccountID: "acct_1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return record
}

func writeManagedTestRuntime(t *testing.T, record instance.Record, phase string, readyAt time.Time) {
	t.Helper()
	if err := os.MkdirAll(record.Config.StateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	data := []byte(`{"pid":42,"phase":"` + phase + `","startedAt":"2026-01-01T00:00:00Z","readyAt":"` + readyAt.Format(time.RFC3339Nano) + `"}`)
	if err := os.WriteFile(filepath.Join(record.Config.StateDir, runtimeStateFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
}
