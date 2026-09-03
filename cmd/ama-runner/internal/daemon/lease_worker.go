package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/protocol"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/runtime"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sandbox"
	runnersession "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/session"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/workspace"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/pkg/sessionevent"
	ama "github.com/saltbo/any-managed-agents/sdk/go/ama"
	"github.com/samber/lo"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type LeaseWorker struct {
	Config          runnerconfig.Config
	Client          *ama.RunnerClient
	SandboxAdapter  sandbox.SandboxAdapter
	RuntimeAdapter  runtime.Adapter
	RuntimeBridge   runtime.Bridge
	Relay           *runnersession.Relay
	RunnerID        string
	CurrentRuntimes func() []runtime.RunnerRuntime
}

// resumeTokenBox shares the latest runtime resume token between the runtime adapter
// and the lease renewal loop.
type resumeTokenBox struct {
	mu    sync.Mutex
	token string
}

func (b *resumeTokenBox) Set(token string) {
	_ = b.SetIfChanged(token)
}

func (b *resumeTokenBox) SetIfChanged(token string) bool {
	if b == nil || token == "" {
		return false
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.token == token {
		return false
	}
	b.token = token
	return true
}

func (b *resumeTokenBox) Get() string {
	if b == nil {
		return ""
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.token
}

func (r LeaseWorker) RunOne(ctx context.Context) error {
	lease, workItem, err := r.claimLease(ctx)
	if err != nil || lease == nil {
		return err
	}
	slog.Info("claimed work item", "workItemId", lease.WorkItemId, "sessionId", workItemSessionID(workItem), "leaseId", lease.Id)
	if err := r.runClaimedWork(ctx, lease, workItem); err != nil {
		return err
	}
	slog.Info("work item completed", "workItemId", lease.WorkItemId, "sessionId", workItemSessionID(workItem))
	return nil
}

func (r LeaseWorker) RunAssigned(ctx context.Context, lease *ama.Lease, workItem *ama.WorkItem) error {
	sessionID := workItemSessionID(workItem)
	payload, payloadErr := protocol.ParseWorkPayload(workItem.Payload)
	err := r.runClaimedWork(ctx, lease, workItem)
	if r.Relay != nil {
		state := "completed"
		if err != nil {
			if ctx.Err() != nil {
				state = "cancelled"
			} else {
				state = "failed"
			}
		}
		sessionActive := err == nil && payloadErr == nil && payload.Type == "session.start" && payload.Runtime == "ama"
		r.Relay.NotifyWorkFinished(context.Background(), sessionID, lease.Id, state, sessionActive)
	}
	if err != nil {
		return err
	}
	slog.Info("work item completed", "workItemId", lease.WorkItemId, "sessionId", sessionID)
	return nil
}

func (r LeaseWorker) claimLease(ctx context.Context) (*ama.Lease, *ama.WorkItem, error) {
	state := ama.ListWorkItemsParamsStateAvailable
	workItems, err := r.Client.WorkItems.List(ctx, &ama.ListWorkItemsParams{State: &state})
	if err != nil {
		return nil, nil, err
	}
	for _, candidate := range workItems.Data {
		lease, err := r.Client.Leases.Create(ctx, ama.CreateLeaseRequest{
			WorkItemId:           candidate.Id,
			RunnerId:             r.RunnerID,
			LeaseDurationSeconds: lo.ToPtr(r.Config.LeaseDurationSeconds),
		})
		if err != nil {
			if IsClaimRaceError(err) {
				continue
			}
			return nil, nil, err
		}
		workItem, err := r.Client.WorkItems.Get(ctx, lease.WorkItemId)
		if err != nil {
			return nil, nil, err
		}
		return lease, workItem, nil
	}
	return nil, nil, nil
}

func (r LeaseWorker) runClaimedWork(ctx context.Context, lease *ama.Lease, workItem *ama.WorkItem) error {
	payload, err := protocol.ParseWorkPayload(workItem.Payload)
	if err != nil {
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if payload.Type == "session.start" && !r.supportsRuntimeRequirement(payload.RuntimeRequirement) {
		err := fmt.Errorf("runner does not satisfy runtime requirement %#v", payload.RuntimeRequirement)
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if payload.Type == "session.start" {
		return r.runSessionStart(ctx, lease, payload)
	}
	return r.runTool(ctx, lease, workItem, payload)
}

func (r LeaseWorker) supportsRuntimeRequirement(required *protocol.RuntimeRequirement) bool {
	if required == nil || r.CurrentRuntimes == nil {
		return false
	}
	for _, entry := range r.CurrentRuntimes() {
		// The control plane assigns new work only while the last reported state is
		// ready. A usage refresh can mark the local snapshot limited before the
		// next heartbeat reaches the control plane; an assignment made in that
		// window is still capability-compatible and must not be misreported as an
		// unsupported runtime or model.
		if entry.Runtime == required.Runtime &&
			(entry.State == runtime.RuntimeStateReady || entry.State == runtime.RuntimeStateLimited) &&
			(required.Model == "" || lo.Contains(entry.Models, required.Model)) {
			return true
		}
	}
	return false
}

func (r LeaseWorker) runTool(ctx context.Context, lease *ama.Lease, workItem *ama.WorkItem, payload protocol.WorkPayload) error {
	if r.SandboxAdapter == nil {
		err := fmt.Errorf("runner sandbox adapter is not configured")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	sessionID := workItemSessionID(workItem)
	if err := r.uploadSessionEvent(ctx, sessionID, runnerEvent(string(sessionevent.EventTypeMessageCompleted), toolCallMessagePayload(payload))); err != nil {
		if ctx.Err() != nil {
			return r.cancelLease(context.Background(), lease, ctx.Err())
		}
		return err
	}

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go r.renewLease(leaseCtx, lease, cancel, renewErrors, nil, nil)

	result, execErr := r.SandboxAdapter.Execute(leaseCtx, sandbox.ToolRequest{
		ToolCallID: payload.ToolCallID,
		ToolName:   payload.ToolName,
		Input:      payload.Input,
		WorkDir:    r.Config.WorkDir,
		Env:        payload.Env,
	})
	cancel()
	if err := firstRenewError(renewErrors); err != nil {
		return err
	}

	if ctx.Err() != nil {
		return r.cancelLease(context.Background(), lease, ctx.Err())
	}
	if execErr != nil {
		_ = r.uploadSessionEvent(context.Background(), sessionID, runnerEvent(string(sessionevent.EventTypeMessageCompleted), toolResultMessagePayload(payload, result.Output, execErr)))
		if finishErr := r.failLease(context.Background(), lease, execErr, result.Output); finishErr != nil {
			return finishErr
		}
		return execErr
	}
	if err := r.uploadSessionEvent(ctx, sessionID, runnerEvent(string(sessionevent.EventTypeMessageCompleted), toolResultMessagePayload(payload, result.Output, nil))); err != nil {
		return err
	}
	return r.completeLease(ctx, lease, ama.JSON{
		"toolCallId": payload.ToolCallID,
		"toolName":   payload.ToolName,
		"output":     result.Output,
	})
}

func (r LeaseWorker) runSessionStart(ctx context.Context, lease *ama.Lease, payload protocol.WorkPayload) error {
	if !isSupportedSessionRuntime(payload.Runtime) {
		err := fmt.Errorf("unsupported session runtime %q", payload.Runtime)
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if payload.Runtime == "ama" {
		return r.runAMASandboxSession(ctx, lease, payload)
	}
	return r.runRuntimeSession(ctx, lease, payload)
}

func isSupportedSessionRuntime(runtimeName string) bool {
	return runtimeName != ""
}

func (r LeaseWorker) runAMASandboxSession(ctx context.Context, lease *ama.Lease, payload protocol.WorkPayload) error {
	relay := r.Relay
	if relay == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	if r.SandboxAdapter == nil {
		err := fmt.Errorf("runner sandbox adapter is not configured")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	renewErrors := make(chan error, 1)
	go r.renewLease(leaseCtx, lease, cancel, renewErrors, nil, nil)

	workspace, _, err := r.prepareWorkspace(leaseCtx, payload)
	if err != nil {
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	runtimeEnv := workspace.RuntimeEnv(payload.Env)
	handle := runnersession.NewSandboxHandle(payload.SessionID, workspace, r.SandboxAdapter, runtimeEnv)
	relay.Register(payload.SessionID, handle)
	if err := r.uploadSessionEvent(leaseCtx, payload.SessionID, runnerEvent(string(sessionevent.EventTypeRuntimeStarted), ama.JSON{})); err != nil {
		relay.Unregister(payload.SessionID)
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	err = r.completeLease(leaseCtx, lease, ama.JSON{
		"sessionId":    payload.SessionID,
		"runtime":      payload.Runtime,
		"sandboxReady": true,
		"workspace":    workspace.Cwd,
	})
	if err != nil {
		relay.Unregister(payload.SessionID)
		return err
	}
	cancel()
	if err := firstRenewError(renewErrors); err != nil && !isCompletedLeaseRenewalRace(err) {
		relay.Unregister(payload.SessionID)
		return err
	}
	return nil
}

func (r LeaseWorker) runRuntimeSession(ctx context.Context, lease *ama.Lease, payload protocol.WorkPayload) error {
	relay := r.Relay
	if relay == nil {
		err := fmt.Errorf("runner relay channel is not started")
		if finishErr := r.failLease(ctx, lease, err, nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	sessionDir := filepath.Join(r.Config.WorkDir, workspace.SessionsDirName, payload.SessionID)
	store, err := runnersession.OpenEventLog(sessionDir, payload.SessionID)
	if err != nil {
		if finishErr := r.failLease(ctx, lease, fmt.Errorf("open session event store: %w", err), nil); finishErr != nil {
			return finishErr
		}
		return err
	}
	relayEvent := func(relayCtx context.Context, event ama.JSON, stamp *runnersession.RelayStamp) error {
		relay.RelayEvent(relayCtx, payload.SessionID, event, stamp)
		return nil
	}
	handle := runnersession.NewHostHandle(payload.SessionID)
	relay.Register(payload.SessionID, handle)
	defer relay.Unregister(payload.SessionID)

	leaseCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	resumeTokens := &resumeTokenBox{}
	leaseUpdates := &sync.Mutex{}
	renewErrors := make(chan error, 1)
	go r.renewLease(leaseCtx, lease, cancel, renewErrors, resumeTokens, leaseUpdates)

	if prompt := workPrompt(payload); prompt != "" {
		if err := r.relayStoredEvent(leaseCtx, store, relayEvent, runnerEvent("message.completed", userPromptEventPayload(prompt))); err != nil {
			if finishErr := r.failLease(context.Background(), lease, err, nil); finishErr != nil {
				return finishErr
			}
			return err
		}
	}

	workspace, agentReport, workspaceErr := r.prepareWorkspace(leaseCtx, payload)
	if workspaceErr != nil {
		result := runtime.Result{Err: workspaceErr}
		writeRuntimeError := func(errPayload ama.JSON) {
			_ = r.relayStoredEvent(context.Background(), store, relayEvent, runnerEvent(string(sessionevent.EventTypeRuntimeError), errPayload))
		}
		finalizeErr := r.finalizeRuntimeSession(leaseCtx, ctx, lease, resumeTokens, result, writeRuntimeError)
		cancel()
		if renewErr := firstRenewError(renewErrors); renewErr != nil {
			if finalizeErr == nil && isCompletedLeaseRenewalRace(renewErr) {
				return nil
			}
			return renewErr
		}
		return finalizeErr
	}

	runtimeRunner := runtime.Runner{
		Adapter:            r.RuntimeAdapter,
		RuntimeBridge:      r.RuntimeBridge,
		MaxSessionDuration: r.Config.MaxSessionDuration,
	}
	runtimeEnv := workspace.RuntimeEnv(payload.Env)
	var writeMu sync.Mutex
	result := runtimeRunner.Run(leaseCtx, runtime.Request{
		SessionID:     payload.SessionID,
		Runtime:       payload.Runtime,
		RuntimeConfig: payload.RuntimeConfig,
		Env:           runtimeEnv,
		Provider:      payload.Provider,
		Model:         payload.Model,
		AgentSnapshot: payload.AgentSnapshot,
		Prompt:        promptWithSkillRefresh(workPrompt(payload), agentReport),
		Resume:        payload.Resume,
		ResumeToken:   payload.ResumeToken,
		WorkDir:       workspace.Cwd,
		OnResumeToken: func(resumeToken string) error {
			return r.persistResumeToken(leaseCtx, lease, resumeTokens, leaseUpdates, resumeToken)
		},
		OnProviderEvent: func(runtimeName string, event runtime.JSON) error {
			_, err := runnersession.AppendProviderEvent(sessionDir, runtimeName, ama.JSON(event))
			return err
		},
		RegisterControlSender: handle.RegisterControlSender,
	}, func(event runtime.JSON) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return r.relayStoredEvent(leaseCtx, store, relayEvent, ama.JSON(event))
	})
	result = r.attachMemoryStores(workspace, result)
	writeRuntimeError := func(errPayload ama.JSON) {
		_ = r.relayStoredEvent(context.Background(), store, relayEvent, runnerEvent(string(sessionevent.EventTypeRuntimeError), errPayload))
	}
	finalizeErr := r.finalizeRuntimeSession(leaseCtx, ctx, lease, resumeTokens, result, writeRuntimeError)
	cancel()
	if renewErr := firstRenewError(renewErrors); renewErr != nil {
		if finalizeErr == nil && isCompletedLeaseRenewalRace(renewErr) {
			return nil
		}
		return renewErr
	}
	return finalizeErr
}

func (r LeaseWorker) finalizeRuntimeSession(
	ctx context.Context,
	requestCtx context.Context,
	lease *ama.Lease,
	resumeTokens *resumeTokenBox,
	result runtime.Result,
	writeRuntimeError func(payload ama.JSON),
) error {
	if result.Err == nil {
		return r.completeLease(ctx, lease, result.Output)
	}
	if successfulRuntimeResult(result.Output) {
		completedResult := cloneResult(result.Output)
		completedResult["completionWarning"] = result.Err.Error()
		return r.completeLease(ctx, lease, completedResult)
	}
	if result.TimedOut {
		timeoutErr := fmt.Errorf("session exceeded max duration %s", r.Config.MaxSessionDuration)
		writeRuntimeError(ama.JSON{"message": timeoutErr.Error(), "code": "session_timeout"})
		if finishErr := r.failLease(context.Background(), lease, timeoutErr, result.Output); finishErr != nil {
			return finishErr
		}
		return timeoutErr
	}
	if requestCtx.Err() != nil {
		if finishErr := r.interruptLease(context.Background(), lease, resumeTokens); finishErr != nil {
			return finishErr
		}
		return result.Err
	}
	writeRuntimeError(ama.JSON{"message": result.Err.Error(), "code": "runtime_failed"})
	if finishErr := r.failLease(context.Background(), lease, result.Err, result.Output); finishErr != nil {
		return finishErr
	}
	return result.Err
}

func (r LeaseWorker) prepareWorkspace(ctx context.Context, payload protocol.WorkPayload) (*workspace.Workspace, workspace.AgentPrepareReport, error) {
	prepared, err := workspace.Prepare(ctx, workspace.PrepareRequest{
		WorkDir:   r.Config.WorkDir,
		SessionID: payload.SessionID,
		Manifest:  payload.WorkspaceManifest,
	})
	if err != nil {
		return nil, workspace.AgentPrepareReport{}, err
	}
	report, err := prepared.PrepareAgentWithReport(ctx, payload.Runtime, payload.AgentSnapshot)
	if err != nil {
		_ = prepared.Cleanup(context.Background())
		return nil, report, err
	}
	return prepared, report, nil
}

func (r LeaseWorker) attachMemoryStores(prepared *workspace.Workspace, result runtime.Result) runtime.Result {
	if result.Err != nil && !successfulRuntimeResult(result.Output) {
		return result
	}
	memoryStores, err := prepared.ReadWritableMemoryStores()
	if err != nil {
		result.Err = err
		return result
	}
	if len(memoryStores) == 0 {
		return result
	}
	if result.Output == nil {
		result.Output = ama.JSON{}
	}
	result.Output["memoryStores"] = memoryStores
	return result
}

func cloneResult(value ama.JSON) ama.JSON {
	return lo.Assign(ama.JSON{}, value)
}

func successfulRuntimeResult(result ama.JSON) bool {
	if result == nil {
		return false
	}
	if exitCodeValue(result["exitCode"]) == 0 {
		return true
	}
	if output, ok := result["output"].(map[string]any); ok && exitCodeValue(output["exitCode"]) == 0 {
		return true
	}
	if output, ok := result["output"].(ama.JSON); ok && exitCodeValue(output["exitCode"]) == 0 {
		return true
	}
	return false
}

func exitCodeValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return -1
	}
}

func workPrompt(payload protocol.WorkPayload) string {
	if payload.Prompt == nil {
		return ""
	}
	return *payload.Prompt
}

func promptWithSkillRefresh(prompt string, report workspace.AgentPrepareReport) string {
	if prompt == "" || len(report.SkillChanges) == 0 {
		return prompt
	}
	lines := []string{"Workspace skills were refreshed before this prompt.", "", "Changed skills:"}
	for _, change := range report.SkillChanges {
		lines = append(lines, fmt.Sprintf("- %s: %s", change.Ref, change.Status))
	}
	lines = append(lines, "", "User prompt:", prompt)
	return strings.Join(lines, "\n")
}

func (r LeaseWorker) renewLease(ctx context.Context, lease *ama.Lease, cancel context.CancelFunc, errors chan<- error, resumeTokens *resumeTokenBox, leaseUpdates *sync.Mutex) {
	ticker := time.NewTicker(r.Config.RenewInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if leaseUpdates != nil {
				leaseUpdates.Lock()
			}
			_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
				State:                lo.ToPtr(ama.UpdateLeaseRequestStateActive),
				LeaseDurationSeconds: lo.ToPtr(r.Config.LeaseDurationSeconds),
				ResumeToken:          lo.EmptyableToPtr(resumeTokenValue(resumeTokens)),
			})
			if leaseUpdates != nil {
				leaseUpdates.Unlock()
			}
			if err != nil {
				select {
				case errors <- fmt.Errorf("runner lease renewal failed: %w", err):
				default:
				}
				cancel()
				return
			}
		}
	}
}

func (r LeaseWorker) persistResumeToken(ctx context.Context, lease *ama.Lease, resumeTokens *resumeTokenBox, leaseUpdates *sync.Mutex, resumeToken string) error {
	if !resumeTokens.SetIfChanged(resumeToken) {
		return nil
	}
	leaseUpdates.Lock()
	defer leaseUpdates.Unlock()
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State:                lo.ToPtr(ama.UpdateLeaseRequestStateActive),
		LeaseDurationSeconds: lo.ToPtr(r.Config.LeaseDurationSeconds),
		ResumeToken:          lo.ToPtr(resumeToken),
	})
	if err != nil {
		return fmt.Errorf("runner lease resume token update failed: %w", err)
	}
	return nil
}

func (r LeaseWorker) uploadSessionEvent(ctx context.Context, sessionID string, event ama.JSON) error {
	if sessionID == "" {
		return nil
	}
	_, err := r.Client.Sessions.CreateRawEvents(ctx, sessionID, []ama.JSON{event})
	return err
}

func (r LeaseWorker) completeLease(ctx context.Context, lease *ama.Lease, result ama.JSON) error {
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State:  lo.ToPtr(ama.UpdateLeaseRequestStateCompleted),
		Result: &result,
	})
	return err
}

func (r LeaseWorker) cancelLease(ctx context.Context, lease *ama.Lease, cause error) error {
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State: lo.ToPtr(ama.UpdateLeaseRequestStateCancelled),
		Error: lo.ToPtr(ama.JSON{"message": cause.Error()}),
	})
	return err
}

func (r LeaseWorker) failLease(ctx context.Context, lease *ama.Lease, failure error, output ama.JSON) error {
	body := ama.UpdateLeaseRequest{
		State: lo.ToPtr(ama.UpdateLeaseRequestStateFailed),
		Error: lo.ToPtr(ama.JSON{"message": failure.Error()}),
	}
	if output != nil {
		body.Result = lo.ToPtr(ama.JSON{"output": output})
	}
	_, err := r.Client.Leases.Update(ctx, lease.Id, body)
	return err
}

func (r LeaseWorker) interruptLease(ctx context.Context, lease *ama.Lease, resumeTokens *resumeTokenBox) error {
	_, err := r.Client.Leases.Update(ctx, lease.Id, ama.UpdateLeaseRequest{
		State:       lo.ToPtr(ama.UpdateLeaseRequestStateInterrupted),
		ResumeToken: lo.EmptyableToPtr(resumeTokenValue(resumeTokens)),
	})
	return err
}

type relaySink func(ctx context.Context, event ama.JSON, relay *runnersession.RelayStamp) error

func (r LeaseWorker) relayStoredEvent(ctx context.Context, store *runnersession.EventLog, relay relaySink, event ama.JSON) error {
	stored, err := store.Append(event)
	if err != nil {
		return err
	}
	return relay(ctx, stored.AmaEvent(), &runnersession.RelayStamp{Sequence: stored.Sequence, ID: stored.ID, CreatedAt: stored.CreatedAt})
}

func runnerEvent(eventType string, payload ama.JSON) ama.JSON {
	return ama.JSON{"type": eventType, "payload": payload}
}

func toolCallMessagePayload(payload protocol.WorkPayload) ama.JSON {
	return ama.JSON{
		"message": ama.JSON{
			"id":   "msg_" + uuid.NewString(),
			"role": "assistant",
			"content": []ama.JSON{
				{
					"type": "tool_call",
					"toolCall": ama.JSON{
						"id":    payload.ToolCallID,
						"name":  payload.ToolName,
						"input": payload.Input,
					},
				},
			},
		},
	}
}

func toolResultMessagePayload(payload protocol.WorkPayload, output ama.JSON, execErr error) ama.JSON {
	result := ama.JSON{
		"content":           toolResultContent(output),
		"structuredContent": output,
	}
	block := ama.JSON{
		"type":       "tool_result",
		"toolCallId": payload.ToolCallID,
		"result":     result,
	}
	if execErr != nil {
		block["error"] = ama.JSON{"message": execErr.Error()}
	}
	return ama.JSON{
		"message": ama.JSON{
			"id":               "msg_" + uuid.NewString(),
			"role":             "tool",
			"parentToolCallId": payload.ToolCallID,
			"content":          []ama.JSON{block},
		},
	}
}

func toolResultContent(output ama.JSON) []ama.JSON {
	if text := toolResultText(output); text != "" {
		return []ama.JSON{{"type": "text", "text": text}}
	}
	return []ama.JSON{{"type": "json", "value": output}}
}

func toolResultText(output ama.JSON) string {
	if output == nil {
		return ""
	}
	for _, key := range []string{"stdout", "stderr", "output", "aggregated_output"} {
		if value, ok := output[key].(string); ok && value != "" {
			return value
		}
	}
	encoded, err := json.Marshal(output)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func userPromptEventPayload(message string) ama.JSON {
	return ama.JSON{
		"message": ama.JSON{
			"id":   "msg_" + uuid.NewString(),
			"role": "user",
			"content": []ama.JSON{
				{"type": "text", "text": message},
			},
		},
	}
}

func firstRenewError(errors <-chan error) error {
	select {
	case renewErr := <-errors:
		return renewErr
	default:
		return nil
	}
}

func isCompletedLeaseRenewalRace(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Runner lease is no longer active")
}

func isLeaseInactive(err error) bool {
	return err != nil && strings.Contains(err.Error(), "is no longer active")
}

func resumeTokenValue(tokens *resumeTokenBox) string {
	if tokens == nil {
		return ""
	}
	return tokens.Get()
}
