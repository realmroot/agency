package runtime

import (
	"context"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/samber/lo"
)

const runtimeUsageRefreshInterval = 5 * time.Minute

type Inventory struct {
	RuntimeBridge Bridge
	Load          func(ctx context.Context, includeUsage bool) (*InventorySnapshot, error)
	LoadUsage     func(ctx context.Context) (*InventorySnapshot, error)

	usageMu            sync.Mutex
	runtimeUsage       []RuntimeUsage
	runtimeUsageLimits map[string]string

	runtimesMu         sync.Mutex
	runtimesLoaded     bool
	advertisedRuntimes []RunnerRuntime
}

func (inv *Inventory) RefreshRuntimes() []RunnerRuntime {
	snapshot, err := inv.load(context.Background(), false)
	if err != nil {
		slog.Warn("runtime bridge inventory failed; runner advertises no CLI-backed runtimes", "error", err)
		snapshot = &InventorySnapshot{}
	}
	entries := runtimes(snapshot)
	inv.runtimesMu.Lock()
	changedToEmpty := inv.advertisedRuntimes == nil || len(inv.advertisedRuntimes) > 0
	inv.runtimesLoaded = true
	inv.advertisedRuntimes = entries
	inv.runtimesMu.Unlock()
	if changedToEmpty && len(entries) == 0 {
		slog.Warn("no CLI-backed runtimes detected; runner advertises no CLI-backed runtimes and will receive no CLI-backed runtime work",
			"binaries", runtimeBinaries(snapshot))
	}
	return inv.CurrentRuntimes()
}

func (inv *Inventory) CurrentRuntimes() []RunnerRuntime {
	inv.runtimesMu.Lock()
	loaded := inv.runtimesLoaded
	entries := append([]RunnerRuntime(nil), inv.advertisedRuntimes...)
	inv.runtimesMu.Unlock()
	if !loaded {
		return inv.RefreshRuntimes()
	}

	inv.usageMu.Lock()
	limits := cloneUsageLimits(inv.runtimeUsageLimits)
	inv.usageMu.Unlock()

	return runtimesWithUsageLimits(entries, limits)
}

func (inv *Inventory) SetUsageSnapshot(snapshot *UsageSnapshot) {
	inv.usageMu.Lock()
	defer inv.usageMu.Unlock()
	if snapshot == nil {
		inv.runtimeUsage = nil
		inv.runtimeUsageLimits = nil
		return
	}
	inv.runtimeUsage = cloneRuntimeUsage(snapshot.Usage)
	inv.runtimeUsageLimits = cloneUsageLimits(snapshot.Limited)
}

func (inv *Inventory) Usage() []RuntimeUsage {
	inv.usageMu.Lock()
	defer inv.usageMu.Unlock()
	return cloneRuntimeUsage(inv.runtimeUsage)
}

func (inv *Inventory) RefreshUsage(ctx context.Context) {
	snapshot, err := inv.loadUsage(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return
		}
		slog.Warn("runtime bridge usage inventory failed", "error", err)
		inv.SetUsageSnapshot(nil)
		return
	}
	inv.SetUsageSnapshot(usageSnapshotFromInventory(snapshot))
}

func (inv *Inventory) loadUsage(ctx context.Context) (*InventorySnapshot, error) {
	if inv.LoadUsage != nil {
		return inv.LoadUsage(ctx)
	}
	if inv.Load != nil {
		return inv.Load(ctx, true)
	}
	return inv.RuntimeBridge.Usage(ctx)
}

func (inv *Inventory) RunUsageCollector(ctx context.Context) {
	ticker := time.NewTicker(runtimeUsageRefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			inv.RefreshUsage(ctx)
		}
	}
}

func (inv *Inventory) load(ctx context.Context, includeUsage bool) (*InventorySnapshot, error) {
	if inv.Load != nil {
		return inv.Load(ctx, includeUsage)
	}
	return inv.RuntimeBridge.Inventory(ctx, includeUsage)
}

func runtimeBinaries(snapshot *InventorySnapshot) []string {
	if snapshot == nil {
		return nil
	}
	return lo.FilterMap(snapshot.Runtimes, func(item InventoryRuntime, _ int) (string, bool) {
		if item.Binary != "" {
			return item.Binary, true
		}
		return "", false
	})
}

func runtimes(snapshot *InventorySnapshot) []RunnerRuntime {
	if snapshot == nil {
		return nil
	}
	inventory := make([]RunnerRuntime, 0, len(snapshot.Runtimes))
	for _, item := range snapshot.Runtimes {
		models := item.Models
		if len(models) == 0 {
			models = item.FallbackModels
		}
		state := item.Status
		if state == "" {
			if item.Installed {
				state = RuntimeStateUnhealthy
			} else {
				state = RuntimeStateMissing
			}
		}
		detail := item.Detail
		if detail == "" {
			detail = "runtime bridge inventory returned no diagnostics"
		}
		inventory = append(inventory, RunnerRuntime{
			Runtime: item.Runtime,
			Models:  append([]string(nil), models...),
			Version: item.Version,
			State:   state,
			Detail:  detail,
		})
	}
	return inventory
}

func usageSnapshotFromInventory(snapshot *InventorySnapshot) *UsageSnapshot {
	if snapshot == nil {
		return nil
	}
	usage := []RuntimeUsage{}
	limited := map[string]string{}
	for _, item := range snapshot.Runtimes {
		if len(item.UsageWindows) > 0 {
			usage = append(usage, RuntimeUsage{Runtime: item.Runtime, Windows: append([]UsageWindow(nil), item.UsageWindows...)})
		}
		if item.LimitedDetail != "" {
			limited[item.Runtime] = item.LimitedDetail
		}
	}
	return &UsageSnapshot{Usage: usage, Limited: limited}
}

func runtimesWithUsageLimits(inventory []RunnerRuntime, limits map[string]string) []RunnerRuntime {
	if len(limits) == 0 {
		return inventory
	}
	result := append([]RunnerRuntime(nil), inventory...)
	for i, entry := range result {
		if entry.State != RuntimeStateReady {
			continue
		}
		detail, limited := limits[entry.Runtime]
		if !limited {
			continue
		}
		result[i].State = RuntimeStateLimited
		result[i].Detail = detail
	}
	return result
}

func cloneRuntimeUsage(usage []RuntimeUsage) []RuntimeUsage {
	if usage == nil {
		return nil
	}
	return lo.Map(usage, func(item RuntimeUsage, _ int) RuntimeUsage {
		item.Windows = slices.Clone(item.Windows)
		return item
	})
}

func cloneUsageLimits(limits map[string]string) map[string]string {
	if limits == nil {
		return nil
	}
	return lo.Assign(map[string]string{}, limits)
}
