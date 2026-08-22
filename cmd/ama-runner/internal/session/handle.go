package session

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
)

type Handle interface {
	Close(ctx context.Context) error
}

type CommandHandler interface {
	Handle
	DeliverCommand(command protocol.RunnerSessionCommand) error
}

type AcknowledgedCommandHandler interface {
	CommandHandler
	DeliverAcknowledgedCommand(command protocol.RunnerSessionCommand) error
}

type SandboxHandler interface {
	Handle
	ExecuteSandbox(ctx context.Context, request protocol.RunnerSandboxRequest) (ama.JSON, error)
}

type HostHandle struct {
	sessionID string

	mu              sync.Mutex
	sendControl     func(runtime.BridgeControlFrame) error
	pendingControls []runtime.BridgeControlFrame
}

func NewHostHandle(sessionID string) *HostHandle {
	return &HostHandle{sessionID: sessionID}
}

func (h *HostHandle) DeliverCommand(command protocol.RunnerSessionCommand) error {
	if len(command) == 0 {
		return nil
	}
	return h.deliverControl(runtime.BridgeControlFrame(command))
}

func (h *HostHandle) DeliverAcknowledgedCommand(command protocol.RunnerSessionCommand) error {
	if len(command) == 0 {
		return nil
	}
	return h.deliverAcknowledgedControl(runtime.BridgeControlFrame(command))
}

func (h *HostHandle) Close(context.Context) error {
	return nil
}

func (h *HostHandle) deliverControl(command runtime.BridgeControlFrame) error {
	return h.deliverControlWithBuffer(command, true)
}

func (h *HostHandle) deliverAcknowledgedControl(command runtime.BridgeControlFrame) error {
	return h.deliverControlWithBuffer(command, false)
}

func (h *HostHandle) deliverControlWithBuffer(command runtime.BridgeControlFrame, allowBuffer bool) error {
	h.mu.Lock()
	send := h.sendControl
	if send == nil {
		if allowBuffer {
			h.pendingControls = append(h.pendingControls, command)
			h.mu.Unlock()
			return nil
		}
		h.mu.Unlock()
		return errors.New("runtime bridge control is not ready")
	}
	h.mu.Unlock()
	if err := send(command); err != nil {
		slog.Warn("runner failed to forward control frame to live runtime", "sessionId", h.sessionID, "error", err)
		return err
	}
	return nil
}

// RegisterControlSender is handed to the runtime adapter as
// runtime.Request.RegisterControlSender; legacy unacknowledged controls flush
// immediately for rolling compatibility with an older control plane.
func (h *HostHandle) RegisterControlSender(send func(runtime.BridgeControlFrame) error) {
	h.mu.Lock()
	pending := h.pendingControls
	h.pendingControls = nil
	h.sendControl = send
	h.mu.Unlock()
	for _, command := range pending {
		if err := send(command); err != nil {
			slog.Warn("runner failed to forward buffered control frame", "sessionId", h.sessionID, "error", err)
		}
	}
}

type SandboxHandle struct {
	sessionID       string
	workspace       *workspace.Workspace
	workspaceClosed bool
	adapter         sandbox.SandboxAdapter
	env             map[string]string
	mu              sync.Mutex
}

func NewSandboxHandle(
	sessionID string,
	prepared *workspace.Workspace,
	adapter sandbox.SandboxAdapter,
	env map[string]string,
) *SandboxHandle {
	return &SandboxHandle{
		sessionID: sessionID,
		workspace: prepared,
		adapter:   adapter,
		env:       cloneEnv(env),
	}
}

func (h *SandboxHandle) Close(ctx context.Context) error {
	h.mu.Lock()
	if h.workspaceClosed {
		h.mu.Unlock()
		return nil
	}
	h.workspaceClosed = true
	workspace := h.workspace
	h.mu.Unlock()
	return workspace.Cleanup(ctx)
}

func (h *SandboxHandle) ExecuteSandbox(ctx context.Context, request protocol.RunnerSandboxRequest) (ama.JSON, error) {
	h.mu.Lock()
	closed := h.workspaceClosed
	workspace := h.workspace
	adapter := h.adapter
	env := cloneEnv(h.env)
	h.mu.Unlock()
	if closed || adapter == nil {
		return nil, errors.New("runner sandbox is not registered for session")
	}
	if workspace == nil {
		return nil, errors.New("runner workspace is not registered for session")
	}
	switch protocol.SandboxRequestType(request) {
	case "sandbox.execute":
		toolCallID := protocol.SandboxRequestToolCallID(request)
		toolName := protocol.SandboxRequestToolName(request)
		started := time.Now()
		result, err := adapter.Execute(ctx, sandbox.ToolRequest{
			ToolCallID: toolCallID,
			ToolName:   toolName,
			Input:      protocol.SandboxRequestInput(request),
			WorkDir:    workspace.Cwd,
			Env:        env,
		})
		response := ama.JSON{
			"toolCallId": toolCallID,
			"toolName":   toolName,
			"output":     result.Output,
			"durationMs": time.Since(started).Milliseconds(),
		}
		if err != nil {
			response["error"] = ama.JSON{"message": err.Error()}
		}
		return response, nil
	case "sandbox.stop":
		return ama.JSON{"ok": true}, h.Close(ctx)
	case "sandbox.readMemoryStores":
		stores, err := workspace.ReadWritableMemoryStores()
		if err != nil {
			return nil, err
		}
		return ama.JSON{"stores": stores}, nil
	default:
		return nil, errors.New("unsupported runner sandbox request")
	}
}

func cloneEnv(env map[string]string) map[string]string {
	if len(env) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(env))
	for key, value := range env {
		cloned[key] = value
	}
	return cloned
}
