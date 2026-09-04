Feature: Runtime
  Enbor owns the session runtime engine: it drives model, tool, and sandbox work for
  a session, normalizes everything into canonical events, and exposes runtime only
  through Enbor session endpoints — never sandbox- or runner-local processes. Running
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

  @runtime/subagent-execution @usecase
  Scenario: Execute a referenced subagent within the parent Session
    Given a Session snapshot contains resolved subagent versions
    When the parent invokes a configured subagent by its alias
    Then the child runs with its own prompt, model selection, and allowed tools
    And the child has no independent identity or nested subagents
    And child work obeys the parent Session policy and cancellation
    And child messages reference the parent tool call without completing the parent turn
    And the parent receives the child result without inheriting its conversation
    And continuation preserves parent tool calls and results but excludes child conversations
    And child work shares the turn budget and resumes without repeating completed tools
    And approval resumes the pending delegation with results in the owning conversation
    And an unknown alias is rejected without starting child work

  @runtime/idle-retention @usecase
  Scenario: Retain an idle cloud Session while allowing its sandbox to sleep
    Given a cloud Session has a sandbox and an optional positive idle retention duration
    When startup has no prompt or a turn settles idle after completion, policy denial, required action, or the continuation cap
    Then the Session remains idle with the same sandbox id
    And startup acquires generation ownership before resolving secrets and renews it after preflight before launching the runtime
    And lifecycle ownership outlives one Worker invocation, while losing ownership before launch causes no sandbox side effect
    And an owned sandbox launch is allowed to settle without an artificial local timeout before completion or failure is recorded
    And pending cleanup uses the current generation epoch and cannot expire a live startup owner
    And completion atomically merges runtime metadata without overwriting metadata changes made while the runtime was launching
    And the cloud runtime applies the configured retention duration or the platform default before releasing sandbox keepalive
    And the next cloud turn reactivates that sandbox and rebuilds its runtime workspace only when the ready marker is absent
    And a sandbox sleep failure is audited without blocking Session state or turn lease settlement
    And a missing, zero, or invalid retention duration falls back to the platform default
    And a duplicate or late startup cannot mutate or destroy a winning or reopened Session generation
    And a startup failure mutates, destroys, and reports only while it owns the same pending generation
    And an approval decision atomically leases an idle Session before tool execution or continuation so duplicate approval and close cannot race it

  @runtime/self-hosted-enbor-cloud-loop @usecase
  Scenario: Run self-hosted Enbor through the cloud turn loop with a runner sandbox
    Given an Enbor session uses a self-hosted environment
    When the runner claims the session work
    Then the runner prepares only the sandbox workspace and tool executor
    And Enbor runs the same cloud turn loop, model calls, turn leases, and canonical event store used by cloud sessions
    And sandbox tools are executed through the runner-backed sandbox channel

  @runtime/workspace-contract @usecase
  Scenario: Keep runner-private state out of the agent workspace
    Given a runtime session mounts repositories, memory stores, credentials, and runner state
    When the agent runtime starts in the session workspace
    Then the current working directory is the agent-visible workspace root
    And repositories are mounted under workspace-relative repos/<owner>/<repo> paths
    And memory stores are mounted under workspace-relative .enbor/memory-stores/<store-id> paths
    And runner-owned state, credentials, process home, process temp, event logs, and control-plane manifests remain outside the agent-visible workspace
    And the runtime prompt describes the workspace layout using workspace-relative paths

  @runtime/enbor-contract-cutover @migration
  Scenario: Migrate persisted runtime contracts to Enbor
    Given persisted resources still use AMA runtime names, references, domains, and environment keys
    When the Enbor contract migration is applied
    Then the persisted runtime, runner protocol, credential, and reference values use Enbor
    And database constraints reject the retired AMA runtime and credential contracts

  @runtime/cooperative-cancellation @usecase
  Scenario: Cancel a running session without starting more work
    Given a session is running model, tool, or sandbox work
    When the cancellation gate trips before completion
    Then the turn aborts and no successful completion events are persisted
    And no new work starts after the cancellation boundary

  @runtime/error-termination @usecase
  Scenario: Separate recoverable tool failures from terminal runtime failures
    Given a tool is dispatched that violates the agent allow-list or fails to execute
    When the runtime executes the turn
    Then a structured tool-result error is recorded in the transcript so the Agent can correct the call
    And failed shell commands preserve bounded standard output and standard error in that tool result
    And only an unrecoverable model, provider, policy, or runtime failure terminalizes the turn

  @runtime/large-bridge-events @usecase
  Scenario: Relay large native runtime events across the runner bridge
    Given a self-hosted runtime emits a native event larger than the old scanner token frame
    When the bridge relays the event to the runner
    Then the event is delivered without protocol-layer truncation
    And the runner terminates the bridge process instead of hanging if protocol reading fails

  @runtime/startup-controls @usecase
  Scenario: Preserve live controls while a self-hosted runtime starts
    Given a self-hosted runtime run is registered before its provider handle is ready
    When a live prompt or other control arrives during provider initialization
    Then the bridge queues controls in arrival order until the provider handle is ready
    And the startup controls do not fail the active runtime request

  @runtime/provider-event-replay @usecase
  Scenario: Capture provider stream events for deterministic session rebuild
    Given a self-hosted external runtime exposes only live SDK stream events
    When the runner receives provider stream events through the runtime bridge
    Then the runner stores those provider events outside the canonical session event log
    And rebuild maps the stored provider events through the same runtime mapper used during live execution

  @runtime/codex-shell-isolation @usecase
  Scenario: Keep Codex tool processes inside the session environment
    Given a self-hosted Codex runtime uses the host account only to authenticate the provider CLI
    When Codex launches a shell tool for the session
    Then the provider CLI reads its login from the host home
    And the shell tool uses the session home, temporary directories, and git configuration
    And the shell tool does not load the host login shell profile

  @runtime/provider-permission-policy @usecase
  Scenario: Configure provider permission policy on the self-hosted runner
    Given a self-hosted Codex or Claude Code runtime operates under managed provider policy
    When the runner starts the provider bridge with provider-scoped permission settings
    Then the bridge validates and applies the configured provider modes
    And an unset setting preserves the existing autonomous default
    And session environment data cannot override runner-owned permission policy

  @runtime/session-history-retention @usecase
  Scenario: Preserve durable session history while expiring runner workspaces
    Given an old self-hosted session has durable history, disposable runner artifacts, and unknown diagnostic artifacts
    When the runner applies workspace retention cleanup
    Then only workspace, state, home, temporary, credential, and non-file log lookalikes are removed
    And regular-file session histories remain unchanged and readable after repeated cleanup
    And unknown files and directories remain available for diagnosis
    And a failed workspace cleanup preserves the session state and artifacts for a later retry
    And log lookalike directories and symbolic links are removed rather than retained as history
    And a stale session without durable history is removed while a recent session remains untouched

  @runtime/sandbox-toolset @usecase
  Scenario: Gate sandbox tools by the agent allow-list
    Given an agent declares a sandbox tool allow-list
    When the runtime initializes sandbox workspace metadata and dispatches sandbox work
    Then tools absent from a non-empty allow-list are rejected
    And an agent with no explicit allow-list is granted the full sandbox toolset
    And the process adapter supports bash, read, write, edit, grep, find, ls, fetch, and web_search
    And sandbox commands receive a runner-controlled home and temporary directory without control-plane credentials

  # ── Session lifecycle over Enbor endpoints (api: cooperative close) ──

  @runtime/close @api
  Scenario: Close a running session cooperatively over the API
    Given a session is running through the Enbor runtime endpoint
    When the user closes the session through the sessions API
    Then the status becomes closed and no successful completion events are written after cancellation
