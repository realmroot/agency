import type { Client, ClientMeta, Options as Options2, RequestResult, TDataShape } from './client/index.js';
import type { ConnectRunnerChannelData, ConnectRunnerChannelErrors, ConnectRunnerChannelResponses, ConnectSessionSocketData, ConnectSessionSocketErrors, CreateAgentData, CreateAgentErrors, CreateAgentResponses, CreateBudgetData, CreateBudgetErrors, CreateBudgetResponses, CreateEnvironmentData, CreateEnvironmentErrors, CreateEnvironmentResponses, CreateIdentityData, CreateIdentityErrors, CreateIdentityResponses, CreateInboxNotificationData, CreateInboxNotificationErrors, CreateInboxNotificationResponses, CreateLeaseData, CreateLeaseErrors, CreateLeaseResponses, CreateMemoryStoreData, CreateMemoryStoreErrors, CreateMemoryStoreMemoryData, CreateMemoryStoreMemoryErrors, CreateMemoryStoreMemoryResponses, CreateMemoryStoreResponses, CreateProjectData, CreateProjectErrors, CreateProjectResponses, CreateRunnerData, CreateRunnerErrors, CreateRunnerResponses, CreateSessionData, CreateSessionErrors, CreateSessionEventsData, CreateSessionEventsErrors, CreateSessionEventsResponses, CreateSessionMessageData, CreateSessionMessageErrors, CreateSessionMessageResponses, CreateSessionResponses, CreateTriggerData, CreateTriggerErrors, CreateTriggerResponses, CreateTriggerRunData, CreateTriggerRunErrors, CreateTriggerRunResponses, CreateVaultCredentialData, CreateVaultCredentialErrors, CreateVaultCredentialResponses, CreateVaultData, CreateVaultErrors, CreateVaultResponses, DecideSessionApprovalData, DecideSessionApprovalErrors, DecideSessionApprovalResponses, DeleteAgentData, DeleteAgentErrors, DeleteAgentResponses, DeleteBudgetData, DeleteBudgetErrors, DeleteBudgetResponses, DeleteEnvironmentData, DeleteEnvironmentErrors, DeleteEnvironmentResponses, DeleteIdentityData, DeleteIdentityErrors, DeleteIdentityResponses, DeleteMemoryStoreData, DeleteMemoryStoreErrors, DeleteMemoryStoreMemoryData, DeleteMemoryStoreMemoryErrors, DeleteMemoryStoreMemoryResponses, DeleteMemoryStoreResponses, DeleteProjectData, DeleteProjectErrors, DeleteProjectResponses, DeleteRunnerData, DeleteRunnerErrors, DeleteRunnerResponses, DeleteSessionData, DeleteSessionErrors, DeleteSessionResponses, DeleteTriggerData, DeleteTriggerErrors, DeleteTriggerResponses, DeleteVaultData, DeleteVaultErrors, DeleteVaultResponses, ListAgentsData, ListAgentsErrors, ListAgentsResponses, ListAgentVersionsData, ListAgentVersionsErrors, ListAgentVersionsResponses, ListAuditRecordsData, ListAuditRecordsErrors, ListAuditRecordsResponses, ListBudgetsData, ListBudgetsErrors, ListBudgetsResponses, ListConnectorsData, ListConnectorsErrors, ListConnectorsResponses, ListEnvironmentsData, ListEnvironmentsErrors, ListEnvironmentsResponses, ListEnvironmentVersionsData, ListEnvironmentVersionsErrors, ListEnvironmentVersionsResponses, ListIdentitiesData, ListIdentitiesErrors, ListIdentitiesResponses, ListLeasesData, ListLeasesErrors, ListLeasesResponses, ListMemoryStoreMemoriesData, ListMemoryStoreMemoriesErrors, ListMemoryStoreMemoriesResponses, ListMemoryStoresData, ListMemoryStoresErrors, ListMemoryStoresResponses, ListModelsData, ListModelsErrors, ListModelsResponses, ListProjectsData, ListProjectsErrors, ListProjectsResponses, ListProviderModelsData, ListProviderModelsErrors, ListProviderModelsResponses, ListProvidersData, ListProvidersErrors, ListProvidersResponses, ListRunnersData, ListRunnersErrors, ListRunnersResponses, ListSessionApprovalsData, ListSessionApprovalsErrors, ListSessionApprovalsResponses, ListSessionEventsData, ListSessionEventsErrors, ListSessionEventsResponses, ListSessionMessagesData, ListSessionMessagesErrors, ListSessionMessagesResponses, ListSessionsData, ListSessionsErrors, ListSessionsResponses, ListTriggerRunsData, ListTriggerRunsErrors, ListTriggerRunsResponses, ListTriggersData, ListTriggersErrors, ListTriggersResponses, ListUsageRecordsData, ListUsageRecordsErrors, ListUsageRecordsResponses, ListVaultCredentialsData, ListVaultCredentialsErrors, ListVaultCredentialsResponses, ListVaultCredentialVersionsData, ListVaultCredentialVersionsErrors, ListVaultCredentialVersionsResponses, ListVaultsData, ListVaultsErrors, ListVaultsResponses, ListWorkItemsData, ListWorkItemsErrors, ListWorkItemsResponses, PutRunnerHeartbeatData, PutRunnerHeartbeatErrors, PutRunnerHeartbeatResponses, ReadAgentData, ReadAgentErrors, ReadAgentResponses, ReadAgentVersionData, ReadAgentVersionErrors, ReadAgentVersionResponses, ReadAuditRecordData, ReadAuditRecordErrors, ReadAuditRecordResponses, ReadAuthConfigData, ReadAuthConfigResponses, ReadBudgetData, ReadBudgetErrors, ReadBudgetResponses, ReadConfigzData, ReadConfigzResponses, ReadConnectorData, ReadConnectorErrors, ReadConnectorResponses, ReadCurrentAuthSessionData, ReadCurrentAuthSessionErrors, ReadCurrentAuthSessionResponses, ReadEnvironmentData, ReadEnvironmentErrors, ReadEnvironmentResponses, ReadEnvironmentVersionData, ReadEnvironmentVersionErrors, ReadEnvironmentVersionResponses, ReadIdentityData, ReadIdentityErrors, ReadIdentityResponses, ReadLeaseData, ReadLeaseErrors, ReadLeaseResponses, ReadMemoryStoreData, ReadMemoryStoreErrors, ReadMemoryStoreResponses, ReadProjectData, ReadProjectErrors, ReadProjectResponses, ReadProviderData, ReadProviderErrors, ReadProviderResponses, ReadRunnerData, ReadRunnerErrors, ReadRunnerHeartbeatData, ReadRunnerHeartbeatErrors, ReadRunnerHeartbeatResponses, ReadRunnerResponses, ReadSessionApprovalData, ReadSessionApprovalErrors, ReadSessionApprovalResponses, ReadSessionData, ReadSessionErrors, ReadSessionMessageData, ReadSessionMessageErrors, ReadSessionMessageResponses, ReadSessionResponses, ReadTriggerData, ReadTriggerErrors, ReadTriggerResponses, ReadTriggerRunData, ReadTriggerRunErrors, ReadTriggerRunResponses, ReadUsageRecordData, ReadUsageRecordErrors, ReadUsageRecordResponses, ReadUsageSummaryData, ReadUsageSummaryErrors, ReadUsageSummaryResponses, ReadVaultCredentialData, ReadVaultCredentialErrors, ReadVaultCredentialResponses, ReadVaultCredentialVersionData, ReadVaultCredentialVersionErrors, ReadVaultCredentialVersionResponses, ReadVaultData, ReadVaultErrors, ReadVaultResponses, ReadWorkItemData, ReadWorkItemErrors, ReadWorkItemResponses, RefreshCatalogData, RefreshCatalogErrors, RefreshCatalogResponses, UpdateAgentData, UpdateAgentErrors, UpdateAgentResponses, UpdateBudgetData, UpdateBudgetErrors, UpdateBudgetResponses, UpdateEnvironmentData, UpdateEnvironmentErrors, UpdateEnvironmentResponses, UpdateLeaseData, UpdateLeaseErrors, UpdateLeaseResponses, UpdateMemoryStoreData, UpdateMemoryStoreErrors, UpdateMemoryStoreMemoryData, UpdateMemoryStoreMemoryErrors, UpdateMemoryStoreMemoryResponses, UpdateMemoryStoreResponses, UpdateProjectData, UpdateProjectErrors, UpdateProjectResponses, UpdateRunnerData, UpdateRunnerErrors, UpdateRunnerResponses, UpdateSessionData, UpdateSessionErrors, UpdateSessionResponses, UpdateTriggerData, UpdateTriggerErrors, UpdateTriggerResponses, UpdateVaultCredentialData, UpdateVaultCredentialErrors, UpdateVaultCredentialResponses, UpdateVaultCredentialSecretData, UpdateVaultCredentialSecretErrors, UpdateVaultCredentialSecretResponses, UpdateVaultData, UpdateVaultErrors, UpdateVaultResponses } from './types.gen.js';
export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean, TResponse = unknown> = Options2<TData, ThrowOnError, TResponse> & {
    /**
     * You can provide a client instance returned by `createClient()` instead of
     * individual options. This might be also useful if you want to implement a
     * custom client.
     */
    client?: Client;
    /**
     * You can pass arbitrary values through the `meta` object. This can be
     * used to access values that aren't defined as part of the SDK function.
     */
    meta?: keyof ClientMeta extends never ? Record<string, unknown> : ClientMeta;
};
/**
 * Read public browser configuration
 */
export declare const readConfigz: <ThrowOnError extends boolean = false>(options?: Options<ReadConfigzData, ThrowOnError>) => RequestResult<ReadConfigzResponses, unknown, ThrowOnError>;
/**
 * Discover available sign-in methods for an organization
 */
export declare const readAuthConfig: <ThrowOnError extends boolean = false>(options?: Options<ReadAuthConfigData, ThrowOnError>) => RequestResult<ReadAuthConfigResponses, unknown, ThrowOnError>;
/**
 * Read the authenticated session context
 */
export declare const readCurrentAuthSession: <ThrowOnError extends boolean = false>(options?: Options<ReadCurrentAuthSessionData, ThrowOnError>) => RequestResult<ReadCurrentAuthSessionResponses, ReadCurrentAuthSessionErrors, ThrowOnError>;
/**
 * List projects in the current organization
 */
export declare const listProjects: <ThrowOnError extends boolean = false>(options?: Options<ListProjectsData, ThrowOnError>) => RequestResult<ListProjectsResponses, ListProjectsErrors, ThrowOnError>;
/**
 * Create a project in the current organization
 */
export declare const createProject: <ThrowOnError extends boolean = false>(options: Options<CreateProjectData, ThrowOnError>) => RequestResult<CreateProjectResponses, CreateProjectErrors, ThrowOnError>;
/**
 * Delete a project with no live resources
 *
 * Soft-deletes a non-default project once all product resources are deleted. Retained tombstones and history do not block deletion.
 */
export declare const deleteProject: <ThrowOnError extends boolean = false>(options: Options<DeleteProjectData, ThrowOnError>) => RequestResult<DeleteProjectResponses, DeleteProjectErrors, ThrowOnError>;
/**
 * Read a single project
 */
export declare const readProject: <ThrowOnError extends boolean = false>(options: Options<ReadProjectData, ThrowOnError>) => RequestResult<ReadProjectResponses, ReadProjectErrors, ThrowOnError>;
/**
 * Rename a project
 */
export declare const updateProject: <ThrowOnError extends boolean = false>(options: Options<UpdateProjectData, ThrowOnError>) => RequestResult<UpdateProjectResponses, UpdateProjectErrors, ThrowOnError>;
/**
 * List agents
 */
export declare const listAgents: <ThrowOnError extends boolean = false>(options?: Options<ListAgentsData, ThrowOnError>) => RequestResult<ListAgentsResponses, ListAgentsErrors, ThrowOnError>;
/**
 * Create an agent
 */
export declare const createAgent: <ThrowOnError extends boolean = false>(options: Options<CreateAgentData, ThrowOnError>) => RequestResult<CreateAgentResponses, CreateAgentErrors, ThrowOnError>;
/**
 * Delete an agent
 *
 * Soft-deletes the agent. The retained tombstone cannot be restored through the API.
 */
export declare const deleteAgent: <ThrowOnError extends boolean = false>(options: Options<DeleteAgentData, ThrowOnError>) => RequestResult<DeleteAgentResponses, DeleteAgentErrors, ThrowOnError>;
/**
 * Read an agent
 */
export declare const readAgent: <ThrowOnError extends boolean = false>(options: Options<ReadAgentData, ThrowOnError>) => RequestResult<ReadAgentResponses, ReadAgentErrors, ThrowOnError>;
/**
 * Update an agent
 *
 * Partially updates a live agent. Identity rebinding while a live Inbox Trigger exists is rejected.
 */
export declare const updateAgent: <ThrowOnError extends boolean = false>(options: Options<UpdateAgentData, ThrowOnError>) => RequestResult<UpdateAgentResponses, UpdateAgentErrors, ThrowOnError>;
/**
 * List agent versions
 */
export declare const listAgentVersions: <ThrowOnError extends boolean = false>(options: Options<ListAgentVersionsData, ThrowOnError>) => RequestResult<ListAgentVersionsResponses, ListAgentVersionsErrors, ThrowOnError>;
/**
 * Read an agent version
 */
export declare const readAgentVersion: <ThrowOnError extends boolean = false>(options: Options<ReadAgentVersionData, ThrowOnError>) => RequestResult<ReadAgentVersionResponses, ReadAgentVersionErrors, ThrowOnError>;
/**
 * List environments
 */
export declare const listEnvironments: <ThrowOnError extends boolean = false>(options?: Options<ListEnvironmentsData, ThrowOnError>) => RequestResult<ListEnvironmentsResponses, ListEnvironmentsErrors, ThrowOnError>;
/**
 * Create an environment
 */
export declare const createEnvironment: <ThrowOnError extends boolean = false>(options: Options<CreateEnvironmentData, ThrowOnError>) => RequestResult<CreateEnvironmentResponses, CreateEnvironmentErrors, ThrowOnError>;
/**
 * Delete an environment
 *
 * Soft-deletes the environment. The retained tombstone cannot be restored through the API.
 */
export declare const deleteEnvironment: <ThrowOnError extends boolean = false>(options: Options<DeleteEnvironmentData, ThrowOnError>) => RequestResult<DeleteEnvironmentResponses, DeleteEnvironmentErrors, ThrowOnError>;
/**
 * Read an environment
 */
export declare const readEnvironment: <ThrowOnError extends boolean = false>(options: Options<ReadEnvironmentData, ThrowOnError>) => RequestResult<ReadEnvironmentResponses, ReadEnvironmentErrors, ThrowOnError>;
/**
 * Update an environment
 *
 * Partially updates a live environment.
 */
export declare const updateEnvironment: <ThrowOnError extends boolean = false>(options: Options<UpdateEnvironmentData, ThrowOnError>) => RequestResult<UpdateEnvironmentResponses, UpdateEnvironmentErrors, ThrowOnError>;
/**
 * List environment versions
 */
export declare const listEnvironmentVersions: <ThrowOnError extends boolean = false>(options: Options<ListEnvironmentVersionsData, ThrowOnError>) => RequestResult<ListEnvironmentVersionsResponses, ListEnvironmentVersionsErrors, ThrowOnError>;
/**
 * Read an environment version
 */
export declare const readEnvironmentVersion: <ThrowOnError extends boolean = false>(options: Options<ReadEnvironmentVersionData, ThrowOnError>) => RequestResult<ReadEnvironmentVersionResponses, ReadEnvironmentVersionErrors, ThrowOnError>;
/**
 * List identities
 */
export declare const listIdentities: <ThrowOnError extends boolean = false>(options?: Options<ListIdentitiesData, ThrowOnError>) => RequestResult<ListIdentitiesResponses, ListIdentitiesErrors, ThrowOnError>;
/**
 * Create an identity
 */
export declare const createIdentity: <ThrowOnError extends boolean = false>(options: Options<CreateIdentityData, ThrowOnError>) => RequestResult<CreateIdentityResponses, CreateIdentityErrors, ThrowOnError>;
/**
 * Delete an identity
 *
 * Soft-deletes the identity. The retained tombstone cannot be restored through the API.
 */
export declare const deleteIdentity: <ThrowOnError extends boolean = false>(options: Options<DeleteIdentityData, ThrowOnError>) => RequestResult<DeleteIdentityResponses, DeleteIdentityErrors, ThrowOnError>;
/**
 * Read an identity
 */
export declare const readIdentity: <ThrowOnError extends boolean = false>(options: Options<ReadIdentityData, ThrowOnError>) => RequestResult<ReadIdentityResponses, ReadIdentityErrors, ThrowOnError>;
/**
 * Reliably receive an Inbox notification
 *
 * Authenticates the per-Subscription callback token, persistently deduplicates by (subscriptionId, eventId), and accepts the Trigger Run before asynchronous Session delivery.
 */
export declare const createInboxNotification: <ThrowOnError extends boolean = false>(options: Options<CreateInboxNotificationData, ThrowOnError>) => RequestResult<CreateInboxNotificationResponses, CreateInboxNotificationErrors, ThrowOnError>;
/**
 * List model vendors
 */
export declare const listProviders: <ThrowOnError extends boolean = false>(options?: Options<ListProvidersData, ThrowOnError>) => RequestResult<ListProvidersResponses, ListProvidersErrors, ThrowOnError>;
/**
 * List all catalog models
 */
export declare const listModels: <ThrowOnError extends boolean = false>(options?: Options<ListModelsData, ThrowOnError>) => RequestResult<ListModelsResponses, ListModelsErrors, ThrowOnError>;
/**
 * Refresh the model catalog
 *
 * Triggers a discovery refresh of the global model catalog (also runs hourly on a schedule).
 */
export declare const refreshCatalog: <ThrowOnError extends boolean = false>(options?: Options<RefreshCatalogData, ThrowOnError>) => RequestResult<RefreshCatalogResponses, RefreshCatalogErrors, ThrowOnError>;
/**
 * Read a model vendor
 */
export declare const readProvider: <ThrowOnError extends boolean = false>(options: Options<ReadProviderData, ThrowOnError>) => RequestResult<ReadProviderResponses, ReadProviderErrors, ThrowOnError>;
/**
 * List a vendor's models
 */
export declare const listProviderModels: <ThrowOnError extends boolean = false>(options: Options<ListProviderModelsData, ThrowOnError>) => RequestResult<ListProviderModelsResponses, ListProviderModelsErrors, ThrowOnError>;
/**
 * List self-hosted runners
 */
export declare const listRunners: <ThrowOnError extends boolean = false>(options?: Options<ListRunnersData, ThrowOnError>) => RequestResult<ListRunnersResponses, ListRunnersErrors, ThrowOnError>;
/**
 * Register a self-hosted runner
 */
export declare const createRunner: <ThrowOnError extends boolean = false>(options: Options<CreateRunnerData, ThrowOnError>) => RequestResult<CreateRunnerResponses, CreateRunnerErrors, ThrowOnError>;
/**
 * Delete a self-hosted runner
 *
 * Soft-deletes the runner. The retained tombstone cannot be restored through the API.
 */
export declare const deleteRunner: <ThrowOnError extends boolean = false>(options: Options<DeleteRunnerData, ThrowOnError>) => RequestResult<DeleteRunnerResponses, DeleteRunnerErrors, ThrowOnError>;
/**
 * Read a self-hosted runner
 */
export declare const readRunner: <ThrowOnError extends boolean = false>(options: Options<ReadRunnerData, ThrowOnError>) => RequestResult<ReadRunnerResponses, ReadRunnerErrors, ThrowOnError>;
/**
 * Update a self-hosted runner
 */
export declare const updateRunner: <ThrowOnError extends boolean = false>(options: Options<UpdateRunnerData, ThrowOnError>) => RequestResult<UpdateRunnerResponses, UpdateRunnerErrors, ThrowOnError>;
/**
 * Read the current runner heartbeat state
 */
export declare const readRunnerHeartbeat: <ThrowOnError extends boolean = false>(options: Options<ReadRunnerHeartbeatData, ThrowOnError>) => RequestResult<ReadRunnerHeartbeatResponses, ReadRunnerHeartbeatErrors, ThrowOnError>;
/**
 * Replace the current runner heartbeat state
 */
export declare const putRunnerHeartbeat: <ThrowOnError extends boolean = false>(options: Options<PutRunnerHeartbeatData, ThrowOnError>) => RequestResult<PutRunnerHeartbeatResponses, PutRunnerHeartbeatErrors, ThrowOnError>;
/**
 * Open the runner relay WebSocket channel
 */
export declare const connectRunnerChannel: <ThrowOnError extends boolean = false>(options: Options<ConnectRunnerChannelData, ThrowOnError>) => RequestResult<ConnectRunnerChannelResponses, ConnectRunnerChannelErrors, ThrowOnError>;
/**
 * List queued self-hosted work items
 */
export declare const listWorkItems: <ThrowOnError extends boolean = false>(options?: Options<ListWorkItemsData, ThrowOnError>) => RequestResult<ListWorkItemsResponses, ListWorkItemsErrors, ThrowOnError>;
/**
 * Read a queued self-hosted work item
 */
export declare const readWorkItem: <ThrowOnError extends boolean = false>(options: Options<ReadWorkItemData, ThrowOnError>) => RequestResult<ReadWorkItemResponses, ReadWorkItemErrors, ThrowOnError>;
/**
 * List work leases
 */
export declare const listLeases: <ThrowOnError extends boolean = false>(options?: Options<ListLeasesData, ThrowOnError>) => RequestResult<ListLeasesResponses, ListLeasesErrors, ThrowOnError>;
/**
 * Claim a specific available work item for a runner
 */
export declare const createLease: <ThrowOnError extends boolean = false>(options: Options<CreateLeaseData, ThrowOnError>) => RequestResult<CreateLeaseResponses, CreateLeaseErrors, ThrowOnError>;
/**
 * Read a work lease
 */
export declare const readLease: <ThrowOnError extends boolean = false>(options: Options<ReadLeaseData, ThrowOnError>) => RequestResult<ReadLeaseResponses, ReadLeaseErrors, ThrowOnError>;
/**
 * Renew or finish a work lease
 */
export declare const updateLease: <ThrowOnError extends boolean = false>(options: Options<UpdateLeaseData, ThrowOnError>) => RequestResult<UpdateLeaseResponses, UpdateLeaseErrors, ThrowOnError>;
/**
 * List budgets
 */
export declare const listBudgets: <ThrowOnError extends boolean = false>(options?: Options<ListBudgetsData, ThrowOnError>) => RequestResult<ListBudgetsResponses, ListBudgetsErrors, ThrowOnError>;
/**
 * Create a budget
 */
export declare const createBudget: <ThrowOnError extends boolean = false>(options: Options<CreateBudgetData, ThrowOnError>) => RequestResult<CreateBudgetResponses, CreateBudgetErrors, ThrowOnError>;
/**
 * Delete a budget
 *
 * Soft-deletes the budget. The retained tombstone cannot be restored through the API.
 */
export declare const deleteBudget: <ThrowOnError extends boolean = false>(options: Options<DeleteBudgetData, ThrowOnError>) => RequestResult<DeleteBudgetResponses, DeleteBudgetErrors, ThrowOnError>;
/**
 * Read a budget
 */
export declare const readBudget: <ThrowOnError extends boolean = false>(options: Options<ReadBudgetData, ThrowOnError>) => RequestResult<ReadBudgetResponses, ReadBudgetErrors, ThrowOnError>;
/**
 * Update a budget
 */
export declare const updateBudget: <ThrowOnError extends boolean = false>(options: Options<UpdateBudgetData, ThrowOnError>) => RequestResult<UpdateBudgetResponses, UpdateBudgetErrors, ThrowOnError>;
/**
 * List connectors
 */
export declare const listConnectors: <ThrowOnError extends boolean = false>(options?: Options<ListConnectorsData, ThrowOnError>) => RequestResult<ListConnectorsResponses, ListConnectorsErrors, ThrowOnError>;
/**
 * Read connector
 */
export declare const readConnector: <ThrowOnError extends boolean = false>(options: Options<ReadConnectorData, ThrowOnError>) => RequestResult<ReadConnectorResponses, ReadConnectorErrors, ThrowOnError>;
/**
 * List usage records
 *
 * Lists usage records for the project. Send Accept: text/csv to export the filtered records as CSV.
 */
export declare const listUsageRecords: <ThrowOnError extends boolean = false>(options?: Options<ListUsageRecordsData, ThrowOnError>) => RequestResult<ListUsageRecordsResponses, ListUsageRecordsErrors, ThrowOnError>;
/**
 * Read a usage record
 */
export declare const readUsageRecord: <ThrowOnError extends boolean = false>(options: Options<ReadUsageRecordData, ThrowOnError>) => RequestResult<ReadUsageRecordResponses, ReadUsageRecordErrors, ThrowOnError>;
/**
 * Read aggregated usage
 *
 * Read-only aggregation of usage records grouped by provider, model, or agent.
 */
export declare const readUsageSummary: <ThrowOnError extends boolean = false>(options?: Options<ReadUsageSummaryData, ThrowOnError>) => RequestResult<ReadUsageSummaryResponses, ReadUsageSummaryErrors, ThrowOnError>;
/**
 * List audit records
 *
 * Lists audit records for the organization. Send Accept: text/csv to export the filtered records as CSV.
 */
export declare const listAuditRecords: <ThrowOnError extends boolean = false>(options?: Options<ListAuditRecordsData, ThrowOnError>) => RequestResult<ListAuditRecordsResponses, ListAuditRecordsErrors, ThrowOnError>;
/**
 * Read an audit record
 */
export declare const readAuditRecord: <ThrowOnError extends boolean = false>(options: Options<ReadAuditRecordData, ThrowOnError>) => RequestResult<ReadAuditRecordResponses, ReadAuditRecordErrors, ThrowOnError>;
/**
 * List triggers
 */
export declare const listTriggers: <ThrowOnError extends boolean = false>(options?: Options<ListTriggersData, ThrowOnError>) => RequestResult<ListTriggersResponses, ListTriggersErrors, ThrowOnError>;
/**
 * Create a trigger
 */
export declare const createTrigger: <ThrowOnError extends boolean = false>(options: Options<CreateTriggerData, ThrowOnError>) => RequestResult<CreateTriggerResponses, CreateTriggerErrors, ThrowOnError>;
/**
 * Delete a trigger
 *
 * Soft-deletes the trigger while retaining its run history. The trigger cannot be restored.
 */
export declare const deleteTrigger: <ThrowOnError extends boolean = false>(options: Options<DeleteTriggerData, ThrowOnError>) => RequestResult<DeleteTriggerResponses, DeleteTriggerErrors, ThrowOnError>;
/**
 * Read a trigger
 */
export declare const readTrigger: <ThrowOnError extends boolean = false>(options: Options<ReadTriggerData, ThrowOnError>) => RequestResult<ReadTriggerResponses, ReadTriggerErrors, ThrowOnError>;
/**
 * Update or pause a trigger
 */
export declare const updateTrigger: <ThrowOnError extends boolean = false>(options: Options<UpdateTriggerData, ThrowOnError>) => RequestResult<UpdateTriggerResponses, UpdateTriggerErrors, ThrowOnError>;
/**
 * List trigger runs
 */
export declare const listTriggerRuns: <ThrowOnError extends boolean = false>(options: Options<ListTriggerRunsData, ThrowOnError>) => RequestResult<ListTriggerRunsResponses, ListTriggerRunsErrors, ThrowOnError>;
/**
 * Create an HTTP trigger run
 *
 * Creates a run for an HTTP trigger using the JSON body, query string, and allowed request headers as prompt template variables.
 */
export declare const createTriggerRun: <ThrowOnError extends boolean = false>(options: Options<CreateTriggerRunData, ThrowOnError>) => RequestResult<CreateTriggerRunResponses, CreateTriggerRunErrors, ThrowOnError>;
/**
 * Read a trigger run
 */
export declare const readTriggerRun: <ThrowOnError extends boolean = false>(options: Options<ReadTriggerRunData, ThrowOnError>) => RequestResult<ReadTriggerRunResponses, ReadTriggerRunErrors, ThrowOnError>;
/**
 * List sessions
 */
export declare const listSessions: <ThrowOnError extends boolean = false>(options?: Options<ListSessionsData, ThrowOnError>) => RequestResult<ListSessionsResponses, ListSessionsErrors, ThrowOnError>;
/**
 * Create a session
 */
export declare const createSession: <ThrowOnError extends boolean = false>(options: Options<CreateSessionData, ThrowOnError>) => RequestResult<CreateSessionResponses, CreateSessionErrors, ThrowOnError>;
/**
 * Delete a session
 *
 * Stops any live runtime and soft-deletes the session while retaining its history. It cannot be restored.
 */
export declare const deleteSession: <ThrowOnError extends boolean = false>(options: Options<DeleteSessionData, ThrowOnError>) => RequestResult<DeleteSessionResponses, DeleteSessionErrors, ThrowOnError>;
/**
 * Read a session
 */
export declare const readSession: <ThrowOnError extends boolean = false>(options: Options<ReadSessionData, ThrowOnError>) => RequestResult<ReadSessionResponses, ReadSessionErrors, ThrowOnError>;
/**
 * Update a session
 *
 * Partial update: name and metadata edits, plus close/reopen transitions (state: "closed"|"idle").
 */
export declare const updateSession: <ThrowOnError extends boolean = false>(options: Options<UpdateSessionData, ThrowOnError>) => RequestResult<UpdateSessionResponses, UpdateSessionErrors, ThrowOnError>;
/**
 * Open the session browser WebSocket (live events + backfill + input)
 */
export declare const connectSessionSocket: <ThrowOnError extends boolean = false>(options: Options<ConnectSessionSocketData, ThrowOnError>) => RequestResult<unknown, ConnectSessionSocketErrors, ThrowOnError>;
/**
 * List session messages
 */
export declare const listSessionMessages: <ThrowOnError extends boolean = false>(options: Options<ListSessionMessagesData, ThrowOnError>) => RequestResult<ListSessionMessagesResponses, ListSessionMessagesErrors, ThrowOnError>;
/**
 * Send a prompt message to a session
 */
export declare const createSessionMessage: <ThrowOnError extends boolean = false>(options: Options<CreateSessionMessageData, ThrowOnError>) => RequestResult<CreateSessionMessageResponses, CreateSessionMessageErrors, ThrowOnError>;
/**
 * Read a session message delivery state
 */
export declare const readSessionMessage: <ThrowOnError extends boolean = false>(options: Options<ReadSessionMessageData, ThrowOnError>) => RequestResult<ReadSessionMessageResponses, ReadSessionMessageErrors, ThrowOnError>;
/**
 * List session events
 *
 * Content negotiation: application/json returns a paginated list, text/csv exports the filtered events, text/event-stream streams new events as SSE.
 */
export declare const listSessionEvents: <ThrowOnError extends boolean = false>(options: Options<ListSessionEventsData, ThrowOnError>) => RequestResult<ListSessionEventsResponses, ListSessionEventsErrors, ThrowOnError>;
/**
 * Batch-create session events
 *
 * Event ingest for runners and clients. Runner OIDC tokens are accepted only while the runner holds an active lease attached to the session.
 */
export declare const createSessionEvents: <ThrowOnError extends boolean = false>(options: Options<CreateSessionEventsData, ThrowOnError>) => RequestResult<CreateSessionEventsResponses, CreateSessionEventsErrors, ThrowOnError>;
/**
 * List tool approvals for a session
 */
export declare const listSessionApprovals: <ThrowOnError extends boolean = false>(options: Options<ListSessionApprovalsData, ThrowOnError>) => RequestResult<ListSessionApprovalsResponses, ListSessionApprovalsErrors, ThrowOnError>;
/**
 * Read a tool approval
 */
export declare const readSessionApproval: <ThrowOnError extends boolean = false>(options: Options<ReadSessionApprovalData, ThrowOnError>) => RequestResult<ReadSessionApprovalResponses, ReadSessionApprovalErrors, ThrowOnError>;
/**
 * Approve or deny a pending tool call
 *
 * Records the human decision for a paused tool call. Approval resumes the runtime and executes the tool (or records the provided custom result); denial resumes the runtime with the denial.
 */
export declare const decideSessionApproval: <ThrowOnError extends boolean = false>(options: Options<DecideSessionApprovalData, ThrowOnError>) => RequestResult<DecideSessionApprovalResponses, DecideSessionApprovalErrors, ThrowOnError>;
/**
 * List memory stores
 */
export declare const listMemoryStores: <ThrowOnError extends boolean = false>(options?: Options<ListMemoryStoresData, ThrowOnError>) => RequestResult<ListMemoryStoresResponses, ListMemoryStoresErrors, ThrowOnError>;
/**
 * Create a memory store
 */
export declare const createMemoryStore: <ThrowOnError extends boolean = false>(options: Options<CreateMemoryStoreData, ThrowOnError>) => RequestResult<CreateMemoryStoreResponses, CreateMemoryStoreErrors, ThrowOnError>;
/**
 * Delete a memory store
 *
 * Soft-deletes the memory store and its memories. Database history remains and cannot be restored.
 */
export declare const deleteMemoryStore: <ThrowOnError extends boolean = false>(options: Options<DeleteMemoryStoreData, ThrowOnError>) => RequestResult<DeleteMemoryStoreResponses, DeleteMemoryStoreErrors, ThrowOnError>;
/**
 * Read a memory store
 */
export declare const readMemoryStore: <ThrowOnError extends boolean = false>(options: Options<ReadMemoryStoreData, ThrowOnError>) => RequestResult<ReadMemoryStoreResponses, ReadMemoryStoreErrors, ThrowOnError>;
/**
 * Update a memory store
 */
export declare const updateMemoryStore: <ThrowOnError extends boolean = false>(options: Options<UpdateMemoryStoreData, ThrowOnError>) => RequestResult<UpdateMemoryStoreResponses, UpdateMemoryStoreErrors, ThrowOnError>;
/**
 * List memories in a memory store
 */
export declare const listMemoryStoreMemories: <ThrowOnError extends boolean = false>(options: Options<ListMemoryStoreMemoriesData, ThrowOnError>) => RequestResult<ListMemoryStoreMemoriesResponses, ListMemoryStoreMemoriesErrors, ThrowOnError>;
/**
 * Create a memory in a memory store
 */
export declare const createMemoryStoreMemory: <ThrowOnError extends boolean = false>(options: Options<CreateMemoryStoreMemoryData, ThrowOnError>) => RequestResult<CreateMemoryStoreMemoryResponses, CreateMemoryStoreMemoryErrors, ThrowOnError>;
/**
 * Delete a memory
 *
 * Soft-deletes the memory. The retained tombstone cannot be restored through the API.
 */
export declare const deleteMemoryStoreMemory: <ThrowOnError extends boolean = false>(options: Options<DeleteMemoryStoreMemoryData, ThrowOnError>) => RequestResult<DeleteMemoryStoreMemoryResponses, DeleteMemoryStoreMemoryErrors, ThrowOnError>;
/**
 * Update a memory
 */
export declare const updateMemoryStoreMemory: <ThrowOnError extends boolean = false>(options: Options<UpdateMemoryStoreMemoryData, ThrowOnError>) => RequestResult<UpdateMemoryStoreMemoryResponses, UpdateMemoryStoreMemoryErrors, ThrowOnError>;
/**
 * List vaults
 */
export declare const listVaults: <ThrowOnError extends boolean = false>(options?: Options<ListVaultsData, ThrowOnError>) => RequestResult<ListVaultsResponses, ListVaultsErrors, ThrowOnError>;
/**
 * Create a vault
 */
export declare const createVault: <ThrowOnError extends boolean = false>(options: Options<CreateVaultData, ThrowOnError>) => RequestResult<CreateVaultResponses, CreateVaultErrors, ThrowOnError>;
/**
 * Delete a vault
 *
 * Soft-deletes the vault while retaining credential history. The vault cannot be restored.
 */
export declare const deleteVault: <ThrowOnError extends boolean = false>(options: Options<DeleteVaultData, ThrowOnError>) => RequestResult<DeleteVaultResponses, DeleteVaultErrors, ThrowOnError>;
/**
 * Read a vault
 */
export declare const readVault: <ThrowOnError extends boolean = false>(options: Options<ReadVaultData, ThrowOnError>) => RequestResult<ReadVaultResponses, ReadVaultErrors, ThrowOnError>;
/**
 * Update a vault
 */
export declare const updateVault: <ThrowOnError extends boolean = false>(options: Options<UpdateVaultData, ThrowOnError>) => RequestResult<UpdateVaultResponses, UpdateVaultErrors, ThrowOnError>;
/**
 * List vault credential metadata
 */
export declare const listVaultCredentials: <ThrowOnError extends boolean = false>(options: Options<ListVaultCredentialsData, ThrowOnError>) => RequestResult<ListVaultCredentialsResponses, ListVaultCredentialsErrors, ThrowOnError>;
/**
 * Create vault credential metadata
 */
export declare const createVaultCredential: <ThrowOnError extends boolean = false>(options: Options<CreateVaultCredentialData, ThrowOnError>) => RequestResult<CreateVaultCredentialResponses, CreateVaultCredentialErrors, ThrowOnError>;
/**
 * Read vault credential metadata
 */
export declare const readVaultCredential: <ThrowOnError extends boolean = false>(options: Options<ReadVaultCredentialData, ThrowOnError>) => RequestResult<ReadVaultCredentialResponses, ReadVaultCredentialErrors, ThrowOnError>;
/**
 * Update or revoke vault credential metadata
 *
 * Revoke with `state: 'revoked'` and an optional `revokeReason`.
 */
export declare const updateVaultCredential: <ThrowOnError extends boolean = false>(options: Options<UpdateVaultCredentialData, ThrowOnError>) => RequestResult<UpdateVaultCredentialResponses, UpdateVaultCredentialErrors, ThrowOnError>;
/**
 * Update a vault credential secret
 *
 * Updates credential secret material. AMA records version snapshots internally for auditability.
 */
export declare const updateVaultCredentialSecret: <ThrowOnError extends boolean = false>(options: Options<UpdateVaultCredentialSecretData, ThrowOnError>) => RequestResult<UpdateVaultCredentialSecretResponses, UpdateVaultCredentialSecretErrors, ThrowOnError>;
/**
 * List vault credential versions
 */
export declare const listVaultCredentialVersions: <ThrowOnError extends boolean = false>(options: Options<ListVaultCredentialVersionsData, ThrowOnError>) => RequestResult<ListVaultCredentialVersionsResponses, ListVaultCredentialVersionsErrors, ThrowOnError>;
/**
 * Read a vault credential version
 */
export declare const readVaultCredentialVersion: <ThrowOnError extends boolean = false>(options: Options<ReadVaultCredentialVersionData, ThrowOnError>) => RequestResult<ReadVaultCredentialVersionResponses, ReadVaultCredentialVersionErrors, ThrowOnError>;
