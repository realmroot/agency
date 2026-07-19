package runtime

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

func TestRunnerRuntimesComeFromBridgeInventory(t *testing.T) {
	got := runtimes(&InventorySnapshot{Runtimes: []InventoryRuntime{
		{
			Runtime:        "codex",
			Installed:      true,
			FallbackModels: []string{"gpt-5.3-codex"},
			Models:         []string{"gpt-5.3-codex", "gpt-5.3-codex-mini"},
		},
		{
			Runtime:        "claude-code",
			Installed:      true,
			FallbackModels: []string{"claude-sonnet-4-6"},
		},
		{
			Runtime:        "copilot",
			Installed:      false,
			FallbackModels: []string{"copilot-cli"},
		},
	}})
	want := []string{"codex", "claude-code", "copilot"}
	if strings.Join(runtimeNames(got), ",") != strings.Join(want, ",") {
		t.Fatalf("expected runtimes %v, got %v", want, got)
	}
	if got[2].State != RuntimeStateMissing {
		t.Fatalf("expected missing runtime to remain visible with state, got %v", got)
	}
}

func runtimeNames(entries []RunnerRuntime) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Runtime)
	}
	return names
}

func TestRuntimeCatalogComesFromBridgeInventory(t *testing.T) {
	got := runtimes(&InventorySnapshot{Runtimes: []InventoryRuntime{
		{
			Runtime:   "codex",
			Installed: true,
			Models:    []string{"gpt-5.3-codex"},
			Status:    RuntimeStateReady,
			Version:   "1.0.0",
			Detail:    "ready",
		},
		{
			Runtime:   "copilot",
			Installed: false,
			Status:    RuntimeStateMissing,
			Detail:    "copilot CLI not found on PATH",
		},
	}})
	if len(got) != 2 {
		t.Fatalf("expected inventory entries, got %#v", got)
	}
	if got[0].Runtime != "codex" || got[0].State != RuntimeStateReady || got[0].Version != "1.0.0" || !slices.Equal(got[0].Models, []string{"gpt-5.3-codex"}) {
		t.Fatalf("unexpected ready inventory %#v", got[0])
	}
	if got[1].Runtime != "copilot" || got[1].State != RuntimeStateMissing {
		t.Fatalf("unexpected missing inventory %#v", got[1])
	}
}

func TestRuntimeCatalogDefaultsStateAndDetail(t *testing.T) {
	got := runtimes(&InventorySnapshot{Runtimes: []InventoryRuntime{
		{Runtime: "codex", Installed: true},
		{Runtime: "copilot", Installed: false},
	}})
	if got[0].State != RuntimeStateUnhealthy || got[0].Detail == "" {
		t.Fatalf("expected installed runtime without status to be unhealthy with detail, got %#v", got[0])
	}
	if got[1].State != RuntimeStateMissing || got[1].Detail == "" {
		t.Fatalf("expected missing runtime without status to be missing with detail, got %#v", got[1])
	}
	if runtimes(nil) != nil || runtimeBinaries(nil) != nil {
		t.Fatal("expected nil snapshots to return nil derived values")
	}
}

func TestRuntimeBinariesReturnsOnlyConfiguredBinaries(t *testing.T) {
	got := runtimeBinaries(&InventorySnapshot{Runtimes: []InventoryRuntime{
		{Runtime: "codex", Binary: "codex"},
		{Runtime: "missing"},
		{Runtime: "claude-code", Binary: "claude"},
	}})
	if strings.Join(got, ",") != "codex,claude" {
		t.Fatalf("unexpected runtime binaries %v", got)
	}
}

func TestInventoryRefreshRuntimesUsesInjectedInventory(t *testing.T) {
	calls := 0
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			calls++
			return &InventorySnapshot{Runtimes: []InventoryRuntime{{
				Runtime:        "codex",
				Installed:      true,
				FallbackModels: []string{"gpt-5.3-codex"},
				Models:         []string{"gpt-5.3-codex-mini"},
				Status:         RuntimeStateReady,
				Detail:         "ready",
			}}}, nil
		},
	}
	got := inv.RefreshRuntimes()
	if calls != 1 {
		t.Fatalf("expected inventory call, got %d", calls)
	}
	if strings.Join(runtimeNames(got), ",") != "codex" {
		t.Fatalf("unexpected runtimes %v", got)
	}
}

func TestInventoryRefreshRuntimesStoresEmptySnapshotOnFailure(t *testing.T) {
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			return nil, errors.New("bridge failed")
		},
	}
	if got := inv.RefreshRuntimes(); len(got) != 0 {
		t.Fatalf("expected empty runtimes, got %#v", got)
	}
	if got := inv.CurrentRuntimes(); len(got) != 0 {
		t.Fatalf("expected stored empty runtimes, got %#v", got)
	}
}

func TestInventoryCurrentRuntimesRefreshesWhenUninitialized(t *testing.T) {
	calls := 0
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			calls++
			return &InventorySnapshot{Runtimes: []InventoryRuntime{{
				Runtime:        "codex",
				Installed:      true,
				FallbackModels: []string{"gpt-5.3-codex"},
			}}}, nil
		},
	}
	if got := inv.CurrentRuntimes(); strings.Join(runtimeNames(got), ",") != "codex" {
		t.Fatalf("unexpected current runtimes %v", got)
	}
	if calls != 1 {
		t.Fatalf("expected lazy refresh, got %d calls", calls)
	}
}

func TestInventoryCurrentRuntimesReturnsStoredCopy(t *testing.T) {
	inv := &Inventory{}
	inv.advertisedRuntimes = []RunnerRuntime{{Runtime: "codex"}}
	got := inv.CurrentRuntimes()
	got[0].Runtime = "mutated"
	if inv.CurrentRuntimes()[0].Runtime != "codex" {
		t.Fatal("current runtimes must return a copy")
	}
}

func TestInventoryRefreshRuntimesClearsOnInventoryFailure(t *testing.T) {
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			return nil, errors.New("bridge failed")
		},
	}
	got := inv.RefreshRuntimes()
	if len(got) != 0 {
		t.Fatalf("expected empty runtimes, got %v", got)
	}
	if gotInventory := inv.CurrentRuntimes(); len(gotInventory) != 0 {
		t.Fatalf("expected empty inventory, got %#v", gotInventory)
	}
}

func TestInventoryRefreshUsageUsesBridgeInventory(t *testing.T) {
	inv := &Inventory{
		Load: func(_ context.Context, includeUsage bool) (*InventorySnapshot, error) {
			if !includeUsage {
				t.Fatal("expected usage refresh to request usage")
			}
			return &InventorySnapshot{Runtimes: []InventoryRuntime{
				{
					Runtime: "claude-code",
					UsageWindows: []UsageWindow{{
						Label:       "5-Hour",
						Utilization: 50,
					}},
				},
				{
					Runtime:       "codex",
					LimitedDetail: "limited",
				},
			}}, nil
		},
	}
	inv.RefreshUsage(context.Background())
	if got := inv.Usage(); len(got) != 1 || got[0].Runtime != "claude-code" {
		t.Fatalf("expected usage from bridge inventory, got %#v", got)
	}
	gotInventory := runtimesWithUsageLimits([]RunnerRuntime{{
		Runtime: "codex",
		State:   RuntimeStateReady,
	}}, inv.runtimeUsageLimits)
	if gotInventory[0].State != RuntimeStateLimited {
		t.Fatalf("expected limited inventory, got %#v", gotInventory)
	}
}

func TestInventoryRefreshUsageClearsOnBridgeFailure(t *testing.T) {
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			return nil, errors.New("usage failed")
		},
	}
	inv.SetUsageSnapshot(&UsageSnapshot{
		Usage:   []RuntimeUsage{{Runtime: "codex"}},
		Limited: map[string]string{"codex": "limited"},
	})
	inv.RefreshUsage(context.Background())
	if got := inv.Usage(); len(got) != 0 {
		t.Fatalf("expected usage cleared on refresh failure, got %#v", got)
	}
}

func TestInventoryRefreshUsageIgnoresCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			return nil, ctx.Err()
		},
	}
	inv.SetUsageSnapshot(&UsageSnapshot{Usage: []RuntimeUsage{{Runtime: "codex"}}})
	inv.RefreshUsage(ctx)
	if got := inv.Usage(); len(got) != 1 || got[0].Runtime != "codex" {
		t.Fatalf("expected cancelled refresh to keep existing usage, got %#v", got)
	}
}

// [spec: runners/heartbeat]
func TestInventoryRunUsageCollectorDoesNotImmediatelyRepeatStartupRefresh(t *testing.T) {
	calls := 0
	inv := &Inventory{
		Load: func(context.Context, bool) (*InventorySnapshot, error) {
			calls++
			return &InventorySnapshot{}, nil
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	inv.RunUsageCollector(ctx)
	if calls != 0 {
		t.Fatalf("expected collector to wait for its first interval before refreshing, got %d calls", calls)
	}
}

func TestInventoryUsageSnapshotFromNilInventory(t *testing.T) {
	if usageSnapshotFromInventory(nil) != nil {
		t.Fatal("expected nil usage snapshot")
	}
	if got := cloneRuntimeUsage(nil); got != nil {
		t.Fatalf("expected nil usage clone, got %#v", got)
	}
	if got := cloneUsageLimits(nil); got != nil {
		t.Fatalf("expected nil limit clone, got %#v", got)
	}
}

func TestInventoryUsageSnapshotOwnsCopiedState(t *testing.T) {
	snapshot := &UsageSnapshot{
		Usage: []RuntimeUsage{{
			Runtime: "claude-code",
			Windows: []UsageWindow{{
				Label:       "five-hour",
				Utilization: 0.5,
			}},
		}},
		Limited: map[string]string{"claude-code": "limited"},
	}
	inv := &Inventory{}
	inv.SetUsageSnapshot(snapshot)

	snapshot.Usage[0].Windows[0].Utilization = 0.9
	snapshot.Limited["claude-code"] = "changed"
	got := inv.Usage()
	got[0].Windows[0].Utilization = 0.1

	again := inv.Usage()
	if again[0].Windows[0].Utilization != 0.5 {
		t.Fatalf("expected inventory to own usage copy, got %#v", again)
	}
	gotInventory := runtimesWithUsageLimits([]RunnerRuntime{{
		Runtime: "claude-code",
		State:   RuntimeStateReady,
	}}, inv.runtimeUsageLimits)
	if gotInventory[0].Detail != "limited" {
		t.Fatalf("expected inventory to own limit copy, got %#v", gotInventory)
	}
}

func TestInventoryNilUsageSnapshotClearsState(t *testing.T) {
	inv := &Inventory{}
	inv.SetUsageSnapshot(&UsageSnapshot{
		Usage:   []RuntimeUsage{{Runtime: "claude-code"}},
		Limited: map[string]string{"claude-code": "limited"},
	})
	inv.SetUsageSnapshot(nil)

	if got := inv.Usage(); len(got) != 0 {
		t.Fatalf("expected usage to clear, got %#v", got)
	}
	gotInventory := runtimesWithUsageLimits([]RunnerRuntime{{
		Runtime: "claude-code",
		State:   RuntimeStateReady,
	}}, inv.runtimeUsageLimits)
	if gotInventory[0].State != RuntimeStateReady {
		t.Fatalf("expected usage limits to clear, got %#v", gotInventory)
	}
}
