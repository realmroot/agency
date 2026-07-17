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

	usageMu            sync.Mutex
	runtimeUsage       []RuntimeUsage
	runtimeUsageLimits map[string]string

	capabilityMu           sync.Mutex
	advertisedCapabilities []string
	advertisedInventory    []RuntimeInventoryEntry
}

func (inv *Inventory) RefreshCapabilities() []string {
	snapshot, err := inv.load(context.Background(), false)
	if err != nil {
		slog.Warn("runtime bridge inventory failed; runner advertises no CLI-backed runtimes", "error", err)
		snapshot = &InventorySnapshot{}
	}
	capabilities := runtimeCapabilities(snapshot)
	inventory := runtimeInventory(snapshot)
	inv.capabilityMu.Lock()
	changed := !slices.Equal(inv.advertisedCapabilities, capabilities)
	inv.advertisedCapabilities = capabilities
	inv.advertisedInventory = inventory
	inv.capabilityMu.Unlock()
	if changed && len(capabilities) == 0 {
		slog.Warn("no CLI-backed runtimes detected; runner advertises no CLI-backed runtimes and will receive no CLI-backed runtime work",
			"binaries", runtimeBinaries(snapshot))
	}
	return capabilities
}

func (inv *Inventory) CurrentCapabilities() []string {
	inv.capabilityMu.Lock()
	capabilities := append([]string(nil), inv.advertisedCapabilities...)
	inv.capabilityMu.Unlock()
	if capabilities == nil {
		return inv.RefreshCapabilities()
	}
	return capabilities
}

func (inv *Inventory) CurrentRuntimeInventory() []RuntimeInventoryEntry {
	inv.capabilityMu.Lock()
	inventory := append([]RuntimeInventoryEntry(nil), inv.advertisedInventory...)
	inv.capabilityMu.Unlock()

	inv.usageMu.Lock()
	limits := cloneUsageLimits(inv.runtimeUsageLimits)
	inv.usageMu.Unlock()

	return runtimeInventoryWithUsageLimits(inventory, limits)
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
	snapshot, err := inv.load(ctx, true)
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

func (inv *Inventory) RunUsageCollector(ctx context.Context) {
	inv.RefreshUsage(ctx)
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

func runtimeCapabilities(snapshot *InventorySnapshot) []string {
	if snapshot == nil {
		return nil
	}
	capabilities := []string{}
	for _, item := range snapshot.Runtimes {
		if !item.Installed {
			continue
		}
		models := item.Models
		if len(models) == 0 {
			models = item.FallbackModels
		}
		capabilities = append(capabilities, item.Runtime)
		for _, model := range models {
			capabilities = append(capabilities, "runtime-provider-model:"+item.Runtime+":*:"+model)
		}
	}
	return capabilities
}

func runtimeInventory(snapshot *InventorySnapshot) []RuntimeInventoryEntry {
	if snapshot == nil {
		return nil
	}
	inventory := make([]RuntimeInventoryEntry, 0, len(snapshot.Runtimes))
	for _, item := range snapshot.Runtimes {
		state := item.Status
		if state == "" {
			if item.Installed {
				state = RuntimeInventoryStateUnhealthy
			} else {
				state = RuntimeInventoryStateMissing
			}
		}
		detail := item.Detail
		if detail == "" {
			detail = "runtime bridge inventory returned no diagnostics"
		}
		inventory = append(inventory, RuntimeInventoryEntry{
			Runtime: item.Runtime,
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

func runtimeInventoryWithUsageLimits(inventory []RuntimeInventoryEntry, limits map[string]string) []RuntimeInventoryEntry {
	if len(limits) == 0 {
		return inventory
	}
	result := append([]RuntimeInventoryEntry(nil), inventory...)
	for i, entry := range result {
		if entry.State != RuntimeInventoryStateReady {
			continue
		}
		detail, limited := limits[entry.Runtime]
		if !limited {
			continue
		}
		result[i].State = RuntimeInventoryStateLimited
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
