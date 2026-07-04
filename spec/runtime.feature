Feature: Runtime
  AMA owns the session runtime engine: it drives model, tool, and sandbox work for
  a session, normalizes everything into canonical events, and exposes runtime only
  through AMA session endpoints — never sandbox- or runner-local processes. Running
  sessions cancel cooperatively and runtime failures terminate sessions in a
  visible, recoverable state.

  # ── Runtime drivers (domain: pure driver selection and metadata) ──

  @runtime/driver-select @domain
  Scenario: Select a supported runtime driver
    Given a session selects a hosting mode and runtime
    When the platform resolves the runtime driver
    Then it picks the canonical cloud or self-hosted driver and rejects unknown runtimes
    And persisted runtime driver metadata is preserved over defaults

  # ── Turn engine (usecase: model + tool + sandbox orchestration) ──

  @runtime/turn @usecase
  Scenario: Run a turn through the model and dispatch tool calls
    Given a session has an agent snapshot, prompt, and configured tool executor
    When the runtime runs the turn
    Then model output is produced and tool calls are dispatched through the executor
    And the next turn context is reconstructed from persisted canonical events

  @runtime/self-hosted-ama-cloud-loop @usecase
  Scenario: Run self-hosted AMA through the cloud turn loop with a runner sandbox
    Given an AMA session uses a self-hosted environment
    When the runner claims the session work
    Then the runner prepares only the sandbox workspace and tool executor
    And AMA runs the same cloud turn loop, model calls, turn leases, and canonical event store used by cloud sessions
    And sandbox tools are executed through the runner-backed sandbox channel

  @runtime/workspace-contract @usecase
  Scenario: Keep runner-private state out of the agent workspace
    Given a runtime session mounts repositories, memory stores, credentials, and runner state
    When the agent runtime starts in the session workspace
    Then the current working directory is the agent-visible workspace root
    And repositories are mounted under workspace-relative repos/<owner>/<repo> paths
    And memory stores are mounted under workspace-relative .ama/memory-stores/<store-id> paths
    And runner-owned state, credentials, process home, process temp, event logs, and control-plane manifests remain outside the agent-visible workspace
    And the runtime prompt describes the workspace layout using workspace-relative paths

  @runtime/cooperative-cancellation @usecase
  Scenario: Cancel a running session without starting more work
    Given a session is running model, tool, or sandbox work
    When the cancellation gate trips before completion
    Then the turn aborts and no successful completion events are persisted
    And no new work starts after the cancellation boundary

  @runtime/error-termination @usecase
  Scenario: Terminate a session after a runtime failure
    Given a tool is dispatched that violates the agent allow-list or fails to execute
    When the runtime executes the turn
    Then a structured error event is recorded and the turn does not complete successfully

  @runtime/large-bridge-events @usecase
  Scenario: Relay large native runtime events across the runner bridge
    Given a self-hosted runtime emits a native event larger than the old scanner token frame
    When the bridge relays the event to the runner
    Then the event is delivered without protocol-layer truncation
    And the runner terminates the bridge process instead of hanging if protocol reading fails

  @runtime/provider-event-replay @usecase
  Scenario: Capture provider stream events for deterministic session rebuild
    Given a self-hosted external runtime exposes only live SDK stream events
    When the runner receives provider stream events through the runtime bridge
    Then the runner stores those provider events outside the canonical session event log
    And rebuild maps the stored provider events through the same runtime mapper used during live execution

  @runtime/sandbox-toolset @usecase
  Scenario: Gate sandbox tools by the agent allow-list
    Given an agent declares a sandbox tool allow-list
    When the runtime initializes sandbox workspace metadata and dispatches sandbox work
    Then tools absent from a non-empty allow-list are rejected
    And an agent with no explicit allow-list is granted the full sandbox toolset

  # ── Session lifecycle over AMA endpoints (api: cooperative close) ──

  @runtime/close @api
  Scenario: Close a running session cooperatively over the API
    Given a session is running through the AMA runtime endpoint
    When the user closes the session through the sessions API
    Then the status becomes closed and no successful completion events are written after cancellation
