package runtime

import (
	"context"
	"encoding/json"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/runtimebridge"
)

type JSON = runtimebridge.JSON

type Request struct {
	SessionID          string
	Runtime            string
	RuntimeConfig      map[string]any
	Env                map[string]string
	Provider           string
	Model              string
	AgentSnapshot      map[string]any
	Prompt             string
	Resume             bool
	ResumeToken        string
	WorkDir            string
	// OnResumeToken is invoked as soon as the runtime learns (or rotates) its
	// resume token, so the runner can persist it before the run completes.
	OnResumeToken func(resumeToken string) error
	// OnProviderEvent records raw provider SDK stream events for deterministic
	// rebuilds. These records are not canonical session events and are not
	// relayed directly to the session transcript.
	OnProviderEvent func(runtimeName string, event JSON) error
	// RegisterControlSender hands the runner a function that forwards opaque
	// bridge control messages into the live runtime. The runner injects only the
	// active requestId and does not interpret command-specific fields.
	RegisterControlSender func(send func(BridgeControlFrame) error)
}

type BridgeControlFrame = json.RawMessage
type BridgeControlType = runtimebridge.RuntimeBridgeControlMessageType

type EventWriter func(event JSON) error

type Adapter interface {
	Run(ctx context.Context, request Request, write EventWriter) (JSON, error)
}

type Result struct {
	Output   JSON
	Err      error
	TimedOut bool
}

type InventorySnapshot struct {
	Runtimes []InventoryRuntime
}

type InventoryRuntime struct {
	Runtime        string
	Binary         string
	Installed      bool
	FallbackModels []string
	Models         []string
	Status         string
	Version        string
	Detail         string
	UsageWindows   []UsageWindow
	LimitedDetail  string
}

type UsageSnapshot struct {
	Usage   []RuntimeUsage
	Limited map[string]string
}

type RunnerRuntime struct {
	Runtime string
	Models  []string
	Version string
	State   string
	Detail  string
}

const (
	RuntimeStateReady           = "ready"
	RuntimeStateLimited         = "limited"
	RuntimeStateMissing         = "missing"
	RuntimeStateUnhealthy       = "unhealthy"
	RuntimeStateUnauthenticated = "unauthenticated"
	RuntimeStateUnauthorized    = "unauthorized"
)

type RuntimeUsage struct {
	Runtime string
	Windows []UsageWindow
}

type UsageWindow = runtimebridge.RuntimeBridgeUsageWindow
