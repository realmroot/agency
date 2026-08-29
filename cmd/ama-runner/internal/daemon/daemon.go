package daemon

import (
	"context"
	"fmt"
	runnerauth "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/auth"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/host"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/version"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"github.com/samber/lo"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

type Daemon struct {
	Config         runnerconfig.Config
	Client         *ama.RunnerClient
	Channels       runnersession.Opener
	Adapter        sandbox.SandboxAdapter
	RuntimeAdapter runtime.Adapter
	RuntimeBridge  runtime.Bridge
	IdentityStore  *IdentityStore
	RuntimeCatalog *runtime.Inventory
	Build          version.Info
	// relay owns the runner's single per-runner relay channel for all sessions.
	// Started once the runner id is known and kept
	// open for the runner's lifetime; nil until Start wires it.
	relay          *runnersession.Relay
	RunnerID       string
	mu             sync.Mutex
	activeLeases   int
	activeLeaseIDs map[string]struct{}
	leaseWG        sync.WaitGroup
}

func (d *Daemon) runtimeBridge() runtime.Bridge {
	bridge := d.RuntimeBridge
	if bridge.ShutdownGraceInterval == 0 {
		bridge.ShutdownGraceInterval = d.Config.ShutdownGraceInterval
	}
	return bridge
}

func (d *Daemon) identityStore() IdentityStore {
	if d.IdentityStore != nil {
		return *d.IdentityStore
	}
	return IdentityStore{Config: d.Config}
}

func (d *Daemon) runtimes() *runtime.Inventory {
	if d.RuntimeCatalog != nil {
		return d.RuntimeCatalog
	}
	d.RuntimeCatalog = &runtime.Inventory{
		RuntimeBridge: d.runtimeBridge(),
	}
	return d.RuntimeCatalog
}

func (d *Daemon) buildInfo() version.Info {
	return d.Build.Normalized()
}

func (d *Daemon) Start(ctx context.Context) error {
	releaseLock, err := acquireStateDirLock(d.Config.StateDir)
	if err != nil {
		return err
	}
	defer releaseLock()
	startedAt := time.Now().UTC()
	if err := d.writeRuntimeState("starting", startedAt, time.Time{}); err != nil {
		return err
	}
	defer d.removeRuntimeState()

	if err := os.MkdirAll(d.Config.WorkDir, 0o755); err != nil {
		return err
	}
	if err := workspace.CleanupStale(ctx, d.Config.WorkDir, workspace.RuntimeWorkspaceRetention); err != nil {
		return err
	}
	configz, err := d.Client.Configz.Get(ctx)
	if err != nil {
		return err
	}
	if err := runnerauth.EnsureCompatibleConfig(configz); err != nil {
		return err
	}
	if err := d.ensureRunnerID(ctx); err != nil {
		return err
	}
	// Runtime usage can make an otherwise installed CLI unschedulable. Probe it
	// before the first heartbeat so the control plane and the local lease guard
	// start from the same runtime state.
	d.refreshRuntimeUsage(ctx)
	if err := d.heartbeatOrRecover(ctx); err != nil {
		if ctx.Err() != nil && d.RunnerID != "" {
			_ = d.sendOfflineHeartbeat(context.Background())
		}
		return err
	}
	if err := d.writeRuntimeState("ready", startedAt, time.Now().UTC()); err != nil {
		_ = d.sendOfflineHeartbeat(context.Background())
		return err
	}
	// One-time readiness line so logs show the runner came up and is connected
	// even when it is idle. List runtime names only; model declarations remain
	// available in the heartbeat for scheduling and diagnostics.
	runtimeNames := lo.Map(d.currentRuntimes(), func(item runtime.RunnerRuntime, _ int) string {
		return item.Runtime
	})
	slog.Info("runner ready; waiting for work assignments",
		"runnerId", d.RunnerID,
		"projectId", d.Config.ProjectID,
		"environmentId", d.Config.EnvironmentID,
		"runtimes", strings.Join(runtimeNames, ", "),
		"maxConcurrent", d.Config.MaxConcurrent,
	)
	go d.runUsageCollector(ctx)
	// Open the per-runner relay channel for CLI sessions and keep it for the
	// runner's lifetime (reconnecting on drop), so a completed CLI session still
	// streams its history over the relay while the runner is online.
	d.startRelay(ctx)
	d.recoverAssignedWork(ctx)

	heartbeatTicker := time.NewTicker(d.Config.HeartbeatInterval)
	defer heartbeatTicker.Stop()
	heartbeatFailures := 0
	for {
		select {
		case <-ctx.Done():
			// Wait for in-flight lease goroutines so their interrupted/failed
			// finalization reaches the control plane before the process exits;
			// otherwise recovery silently degrades to lease-expiry timing.
			d.drainInFlightLeases(&d.leaseWG)
			_ = d.sendOfflineHeartbeat(context.Background())
			return ctx.Err()
		case <-heartbeatTicker.C:
			if err := d.heartbeat(ctx); err != nil {
				if ctx.Err() != nil {
					d.drainInFlightLeases(&d.leaseWG)
					_ = d.sendOfflineHeartbeat(context.Background())
					return ctx.Err()
				}
				// The control plane forgot this runner (reaped or data reset):
				// re-register under a fresh id instead of heartbeating a ghost.
				if IsRunnerGoneError(err) {
					slog.Warn("runner registration was lost; re-registering", "error", err)
					if recoverErr := d.recoverRunnerIdentity(ctx); recoverErr != nil {
						heartbeatFailures++
						slog.Warn("runner re-registration failed", "consecutiveFailures", heartbeatFailures, "error", recoverErr)
						if heartbeatFailures >= heartbeatMaxConsecutiveFailures {
							d.drainInFlightLeases(&d.leaseWG)
							return fmt.Errorf("runner re-registration failed %d consecutive times: %w", heartbeatFailures, recoverErr)
						}
						continue
					}
					heartbeatFailures = 0
					continue
				}
				// A transient network blip must not take the runner offline and
				// interrupt every running session; give up only when the control
				// plane stays unreachable across many consecutive intervals.
				heartbeatFailures++
				slog.Warn("runner heartbeat failed", "consecutiveFailures", heartbeatFailures, "error", err)
				if heartbeatFailures >= heartbeatMaxConsecutiveFailures {
					d.drainInFlightLeases(&d.leaseWG)
					return fmt.Errorf("runner heartbeat failed %d consecutive times: %w", heartbeatFailures, err)
				}
				continue
			}
			heartbeatFailures = 0
		}
	}
}

const (
	// 10 × HeartbeatInterval (default 30s) ≈ 5 minutes of control-plane
	// unreachability before the runner gives up and exits.
	heartbeatMaxConsecutiveFailures = 10
	leaseClaimBackoffCap            = time.Minute
	leaseClaimBackoffMaxShift       = 6
)

// leasePollDelay backs the lease poll off exponentially while claims keep
// failing, so a broken control plane is not hammered at full poll speed.
func leasePollDelay(base time.Duration, consecutiveFailures int64) time.Duration {
	if consecutiveFailures <= 0 {
		return base
	}
	shift := consecutiveFailures
	if shift > leaseClaimBackoffMaxShift {
		shift = leaseClaimBackoffMaxShift
	}
	delay := base << shift
	if delay <= 0 || delay > leaseClaimBackoffCap {
		return leaseClaimBackoffCap
	}
	return delay
}

func (d *Daemon) drainInFlightLeases(inFlight *sync.WaitGroup) {
	done := make(chan struct{})
	go func() {
		inFlight.Wait()
		close(done)
	}()
	// The runtime gets ShutdownGraceInterval to exit after SIGTERM; allow that
	// plus headroom for the interrupted-status upload.
	select {
	case <-done:
	case <-time.After(d.Config.ShutdownGraceInterval + 10*time.Second):
		slog.Warn("shutdown drain timed out; in-flight lease finalization may be lost")
	}
}

func (d *Daemon) RunOnce(ctx context.Context) error {
	releaseLock, err := acquireStateDirLock(d.Config.StateDir)
	if err != nil {
		return err
	}
	defer releaseLock()

	if err := d.ensureRunnerID(ctx); err != nil {
		return err
	}
	d.refreshRuntimeUsage(ctx)
	if err := d.heartbeatOrRecover(ctx); err != nil {
		return err
	}
	d.startRelay(ctx)
	if !d.tryAcquireLeaseSlot() {
		return nil
	}
	defer d.releaseLeaseSlot()
	return d.runOneLease(ctx)
}

// startRelay wires the per-runner relay channel once the runner id is known and
// runs it under the daemon context. Idempotent: a second call is a no-op so Start
// and RunOnce can both call it.
func (d *Daemon) startRelay(ctx context.Context) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.relay != nil {
		return
	}
	d.relay = runnersession.NewRelay(d.Channels, d.RunnerID, d.Config.WorkDir, d.runAssignedWork)
	go d.relay.Run(ctx)
}

func (d *Daemon) runOneLease(ctx context.Context) error {
	return d.leaseWorker().RunOne(ctx)
}

func (d *Daemon) runAssignedWork(ctx context.Context, lease *ama.Lease, workItem *ama.WorkItem) {
	if !d.tryAcquireLeaseSlotFor(lease.Id) {
		slog.Warn("runner received work assignment while at local capacity", "workItemId", workItem.Id, "leaseId", lease.Id)
		return
	}
	d.leaseWG.Add(1)
	go func() {
		defer d.leaseWG.Done()
		defer d.releaseLeaseSlotFor(lease.Id)
		if err := d.leaseWorker().RunAssigned(ctx, lease, workItem); err != nil {
			if ctx.Err() != nil {
				return
			}
			if isLeaseInactive(err) {
				slog.Info("runner assigned lease ended", "leaseId", lease.Id, "error", err)
				return
			}
			slog.Warn("runner assigned lease failed", "leaseId", lease.Id, "workItemId", workItem.Id, "error", err)
		}
	}()
}

func (d *Daemon) recoverAssignedWork(ctx context.Context) {
	if d.RunnerID == "" {
		return
	}
	runnerID := d.RunnerID
	state := ama.ListLeasesParamsStateActive
	limit := 100
	var cursor *string
	for {
		leases, err := d.Client.Leases.List(ctx, &ama.ListLeasesParams{
			RunnerId: &runnerID,
			State:    &state,
			Limit:    &limit,
			Cursor:   cursor,
		})
		if err != nil {
			slog.Warn("runner failed to recover assigned work", "runnerId", runnerID, "error", err)
			return
		}
		for _, lease := range leases.Data {
			workItem, err := d.Client.WorkItems.Get(ctx, lease.WorkItemId)
			if err != nil {
				slog.Warn("runner failed to recover assigned work item", "runnerId", runnerID, "leaseId", lease.Id, "workItemId", lease.WorkItemId, "error", err)
				continue
			}
			leaseCopy := lease
			d.runAssignedWork(ctx, &leaseCopy, workItem)
		}
		if !leases.Pagination.HasMore || leases.Pagination.NextCursor == nil {
			return
		}
		cursor = leases.Pagination.NextCursor
	}
}

func (d *Daemon) leaseWorker() LeaseWorker {
	d.mu.Lock()
	relay := d.relay
	d.mu.Unlock()
	return LeaseWorker{
		Config:          d.Config,
		Client:          d.Client,
		SandboxAdapter:  d.Adapter,
		RuntimeAdapter:  d.RuntimeAdapter,
		RuntimeBridge:   d.runtimeBridge(),
		Relay:           relay,
		RunnerID:        d.RunnerID,
		CurrentRuntimes: d.currentRuntimes,
	}
}

func (d *Daemon) tryAcquireLeaseSlot() bool {
	return d.tryAcquireLeaseSlotFor("")
}

func (d *Daemon) tryAcquireLeaseSlotFor(leaseID string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if leaseID != "" {
		if d.activeLeaseIDs == nil {
			d.activeLeaseIDs = map[string]struct{}{}
		}
		if _, active := d.activeLeaseIDs[leaseID]; active {
			return false
		}
	}
	if d.activeLeases >= d.Config.MaxConcurrent {
		return false
	}
	d.activeLeases += 1
	if leaseID != "" {
		d.activeLeaseIDs[leaseID] = struct{}{}
	}
	return true
}

func (d *Daemon) releaseLeaseSlot() {
	d.releaseLeaseSlotFor("")
}

func (d *Daemon) releaseLeaseSlotFor(leaseID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.activeLeases > 0 {
		d.activeLeases -= 1
	}
	if leaseID != "" && d.activeLeaseIDs != nil {
		delete(d.activeLeaseIDs, leaseID)
	}
}

func (d *Daemon) activeLoad() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.activeLeases
}

func (d *Daemon) ensureRunnerID(ctx context.Context) error {
	if d.RunnerID != "" {
		return nil
	}
	identity := d.identityStore()
	storedRunnerID, err := identity.LoadRunnerID()
	if err != nil {
		return err
	}
	if storedRunnerID != "" {
		d.RunnerID = storedRunnerID
		return nil
	}
	runnerID, err := d.ensureRunner(ctx)
	if err != nil {
		return err
	}
	d.RunnerID = runnerID
	if err := identity.StoreRunnerID(runnerID); err != nil {
		return err
	}
	return nil
}

// recoverRunnerIdentity forgets the current (stale) runner id — both in memory
// and in the persisted state file — and registers a fresh runner. Called when
// the control plane reports the runner row is gone (404).
func (d *Daemon) recoverRunnerIdentity(ctx context.Context) error {
	d.RunnerID = ""
	if err := d.identityStore().ClearRunnerID(); err != nil {
		return err
	}
	return d.ensureRunnerID(ctx)
}

// heartbeatOrRecover sends a heartbeat and, if the control plane reports the
// runner is gone (404), re-registers once and retries. Used on the startup
// paths where a single heartbeat must succeed before proceeding.
func (d *Daemon) heartbeatOrRecover(ctx context.Context) error {
	err := d.heartbeat(ctx)
	if err == nil || !IsRunnerGoneError(err) {
		return err
	}
	slog.Warn("runner registration was lost; re-registering", "error", err)
	if recoverErr := d.recoverRunnerIdentity(ctx); recoverErr != nil {
		return recoverErr
	}
	return d.heartbeat(ctx)
}

func (d *Daemon) ensureRunner(ctx context.Context) (string, error) {
	machineID, err := d.identityStore().EnsureMachineID()
	if err != nil {
		return "", err
	}
	build := d.buildInfo()
	hostInfo := host.Current()
	runner, err := d.Client.Runners.Create(ctx, ama.CreateRunnerRequest{
		Name:          displayName(),
		EnvironmentId: lo.EmptyableToPtr(d.Config.EnvironmentID),
		MaxConcurrent: lo.ToPtr(d.Config.MaxConcurrent),
		Metadata: lo.ToPtr(ama.JSON{
			"sandboxAdapter":         sandbox.HostAdapterName(),
			"commandAcknowledgement": true,
			"os":                     hostInfo.OS,
			"arch":                   hostInfo.Arch,
			"machineId":              machineID,
			"hostname":               displayName(),
			"runnerVersion":          build.Version,
			"runnerCommit":           build.Commit,
			"runnerBuildDate":        build.BuildDate,
		}),
	})
	if err != nil {
		return "", err
	}
	return runner.Id, nil
}

func (d *Daemon) heartbeat(ctx context.Context) error {
	machineID, err := d.identityStore().EnsureMachineID()
	if err != nil {
		return err
	}
	runtimes := d.refreshRuntimes()
	build := d.buildInfo()
	hostInfo := host.Current()
	_, err = d.Client.Runners.PutHeartbeat(ctx, d.RunnerID, ama.PutRunnerHeartbeatRequest{
		State:        lo.ToPtr(ama.PutRunnerHeartbeatRequestStateActive),
		RuntimeUsage: lo.ToPtr(runnerRuntimeUsage(d.getRuntimeUsage())),
		Runtimes:     lo.ToPtr(runnerRuntimes(runtimes)),
		Metadata: lo.ToPtr(ama.JSON{
			"sandboxAdapter":         sandbox.HostAdapterName(),
			"commandAcknowledgement": true,
			"os":                     hostInfo.OS,
			"arch":                   hostInfo.Arch,
			"machineId":              machineID,
			"hostname":               displayName(),
			"runnerVersion":          build.Version,
			"runnerCommit":           build.Commit,
			"runnerBuildDate":        build.BuildDate,
			"unsafe":                 true,
		}),
	})
	return err
}

func (d *Daemon) sendOfflineHeartbeat(ctx context.Context) error {
	_, err := d.Client.Runners.PutHeartbeat(ctx, d.RunnerID, ama.PutRunnerHeartbeatRequest{
		State: lo.ToPtr(ama.PutRunnerHeartbeatRequestStateOffline),
	})
	return err
}

func (d *Daemon) refreshRuntimes() []runtime.RunnerRuntime {
	return withAMARuntime(d.runtimes().RefreshRuntimes(), host.SupportsAMARuntime())
}

func (d *Daemon) currentRuntimes() []runtime.RunnerRuntime {
	return withAMARuntime(d.runtimes().CurrentRuntimes(), host.SupportsAMARuntime())
}

func (d *Daemon) setRuntimeUsageSnapshot(snapshot *runtime.UsageSnapshot) {
	d.runtimes().SetUsageSnapshot(snapshot)
}

func (d *Daemon) getRuntimeUsage() []runtime.RuntimeUsage {
	return d.runtimes().Usage()
}

func (d *Daemon) refreshRuntimeUsage(ctx context.Context) {
	d.runtimes().RefreshUsage(ctx)
}

func (d *Daemon) runUsageCollector(ctx context.Context) {
	d.runtimes().RunUsageCollector(ctx)
}

func withAMARuntime(inventory []runtime.RunnerRuntime, supportsAMA bool) []runtime.RunnerRuntime {
	if !supportsAMA || lo.ContainsBy(inventory, func(entry runtime.RunnerRuntime) bool { return entry.Runtime == "ama" }) {
		return inventory
	}
	return append([]runtime.RunnerRuntime{{
		Runtime: "ama",
		Models:  []string{},
		State:   runtime.RuntimeStateReady,
		Detail:  "AMA runtime is available",
	}}, inventory...)
}

func runnerRuntimes(runtimes []runtime.RunnerRuntime) []ama.RunnerRuntime {
	return lo.Map(runtimes, func(entry runtime.RunnerRuntime, _ int) ama.RunnerRuntime {
		return ama.RunnerRuntime{
			Runtime: entry.Runtime,
			Models:  entry.Models,
			Version: lo.EmptyableToPtr(entry.Version),
			State:   ama.RunnerRuntimeState(entry.State),
			Detail:  lo.ToPtr(entry.Detail),
		}
	})
}

func runnerRuntimeUsage(usage []runtime.RuntimeUsage) []ama.RuntimeUsage {
	return lo.Map(usage, func(item runtime.RuntimeUsage, _ int) ama.RuntimeUsage {
		return ama.RuntimeUsage{
			Runtime: item.Runtime,
			Windows: lo.Map(item.Windows, func(window runtime.UsageWindow, _ int) ama.RuntimeUsageWindow {
				return ama.RuntimeUsageWindow{
					Label:       window.Label,
					Utilization: window.Utilization,
					ResetsAt:    window.ResetsAt,
				}
			}),
		}
	})
}
