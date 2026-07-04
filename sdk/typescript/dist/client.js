// Stable facades generated from sdk/spec/resources.json.
// The generated OpenAPI layer owns HTTP shapes; this file owns SDK shape.
import { createClient, createConfig } from './generated/client/index.js';
import * as ops from './generated/sdk.gen.js';
export class AmaApiError extends Error {
    status;
    responseText;
    body;
    constructor(status, responseText, body) {
        super(`AMA API request failed${status === undefined ? '' : ` with HTTP ${status}`}`);
        this.status = status;
        this.responseText = responseText;
        this.body = body;
        this.name = 'AmaApiError';
    }
}
async function unwrap(call) {
    const { data, error, response } = await call;
    if (response?.ok && error === undefined) {
        return data;
    }
    const body = error ?? data;
    throw new AmaApiError(response?.status, typeof body === 'string' ? body : JSON.stringify(body ?? {}), body);
}
function websocketURL(config, path) {
    const url = new URL(path, config.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    if (config.accessToken) {
        url.searchParams.set('access_token', config.accessToken);
    }
    if (config.projectId) {
        url.searchParams.set('x-ama-project-id', config.projectId);
    }
    return url;
}
function createSessionStream(config, sessionId) {
    const socket = new WebSocket(websocketURL(config, `/api/v1/sessions/${encodeURIComponent(sessionId)}/socket`).toString());
    const buffered = [];
    const waiters = [];
    const backfillWaiters = new Map();
    let done = false;
    const drainDone = () => {
        done = true;
        for (const resolve of waiters.splice(0)) {
            resolve({ value: undefined, done: true });
        }
    };
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : '');
        if (message.type === 'event') {
            const waiter = waiters.shift();
            if (waiter) {
                waiter({ value: message.record, done: false });
            }
            else {
                buffered.push(message.record);
            }
        }
        else if (message.type === 'backfill') {
            const resolve = message.requestId ? backfillWaiters.get(message.requestId) : undefined;
            if (message.requestId) {
                backfillWaiters.delete(message.requestId);
            }
            resolve?.(message);
        }
    });
    socket.addEventListener('close', drainDone);
    const ready = new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('Session socket failed to open')));
    });
    let backfillSeq = 0;
    return {
        events: {
            [Symbol.asyncIterator]() {
                return {
                    next() {
                        const value = buffered.shift();
                        if (value !== undefined) {
                            return Promise.resolve({ value, done: false });
                        }
                        if (done) {
                            return Promise.resolve({ value: undefined, done: true });
                        }
                        return new Promise((resolve) => waiters.push(resolve));
                    },
                };
            },
        },
        async send(message) {
            await ready;
            socket.send(JSON.stringify(message));
        },
        async backfill(options = {}) {
            await ready;
            const requestId = `bf_${(backfillSeq += 1)}`;
            const response = new Promise((resolve) => backfillWaiters.set(requestId, resolve));
            socket.send(JSON.stringify({ type: 'backfill', requestId, ...options }));
            return response;
        },
        close() {
            socket.close();
        },
    };
}
function createRunnerChannel(config, runnerId) {
    const socket = new WebSocket(websocketURL(config, `/api/v1/runners/${encodeURIComponent(runnerId)}/channel`).toString());
    const buffered = [];
    const waiters = [];
    let done = false;
    const drainDone = () => {
        done = true;
        for (const resolve of waiters.splice(0)) {
            resolve({ value: undefined, done: true });
        }
    };
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(typeof event.data === 'string' ? event.data : '');
        const waiter = waiters.shift();
        if (waiter) {
            waiter({ value: message, done: false });
        }
        else {
            buffered.push(message);
        }
    });
    socket.addEventListener('close', drainDone);
    const ready = new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('Runner channel failed to open')));
    });
    return {
        messages: {
            [Symbol.asyncIterator]() {
                return {
                    next() {
                        const value = buffered.shift();
                        if (value !== undefined) {
                            return Promise.resolve({ value, done: false });
                        }
                        if (done) {
                            return Promise.resolve({ value: undefined, done: true });
                        }
                        return new Promise((resolve) => waiters.push(resolve));
                    },
                };
            },
        },
        async send(message) {
            await ready;
            socket.send(JSON.stringify(message));
        },
        close() {
            socket.close();
        },
    };
}
function createConfiguredClient(config) {
    return createClient(createConfig({
        baseUrl: config.baseUrl,
        headers: {
            ...(config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {}),
            ...(config.projectId ? { 'x-ama-project-id': config.projectId } : {}),
            ...config.headers,
        },
    }));
}
export function createAmaClient(config) {
    const client = createConfiguredClient(config);
    return {
        raw: client,
        configz: {
            get: () => unwrap(ops.readConfigz({ client })),
        },
        auth: {
            config: (query) => unwrap(ops.readAuthConfig({ client, query })),
            createSession: (body) => unwrap(ops.createAuthSession({ client, body })),
            currentSession: () => unwrap(ops.readCurrentAuthSession({ client })),
            deleteCurrentSession: () => unwrap(ops.deleteCurrentAuthSession({ client })),
        },
        projects: {
            list: (query) => unwrap(ops.listProjects({ client, query })),
            create: (body) => unwrap(ops.createProject({ client, body })),
            get: (projectId) => unwrap(ops.readProject({ client, path: { projectId } })),
        },
        agents: {
            list: (query) => unwrap(ops.listAgents({ client, query })),
            create: (body) => unwrap(ops.createAgent({ client, body })),
            get: (agentId) => unwrap(ops.readAgent({ client, path: { agentId } })),
            update: (agentId, body) => unwrap(ops.updateAgent({ client, path: { agentId }, body })),
            listVersions: (agentId) => unwrap(ops.listAgentVersions({ client, path: { agentId } })),
            getVersion: (agentId, version) => unwrap(ops.readAgentVersion({ client, path: { agentId, version } })),
        },
        environments: {
            list: (query) => unwrap(ops.listEnvironments({ client, query })),
            create: (body) => unwrap(ops.createEnvironment({ client, body })),
            get: (environmentId) => unwrap(ops.readEnvironment({ client, path: { environmentId } })),
            update: (environmentId, body) => unwrap(ops.updateEnvironment({ client, path: { environmentId }, body })),
            listVersions: (environmentId) => unwrap(ops.listEnvironmentVersions({ client, path: { environmentId } })),
            getVersion: (environmentId, version) => unwrap(ops.readEnvironmentVersion({ client, path: { environmentId, version } })),
        },
        providers: {
            list: () => unwrap(ops.listProviders({ client })),
            listModels: () => unwrap(ops.listModels({ client })),
            refreshCatalog: () => unwrap(ops.refreshCatalog({ client })),
            get: (providerId) => unwrap(ops.readProvider({ client, path: { providerId } })),
            listProviderModels: (providerId) => unwrap(ops.listProviderModels({ client, path: { providerId } })),
        },
        runners: {
            list: (query) => unwrap(ops.listRunners({ client, query })),
            create: (body) => unwrap(ops.createRunner({ client, body })),
            get: (runnerId) => unwrap(ops.readRunner({ client, path: { runnerId } })),
            update: (runnerId, body) => unwrap(ops.updateRunner({ client, path: { runnerId }, body })),
        },
        budgets: {
            list: () => unwrap(ops.listBudgets({ client })),
            create: (body) => unwrap(ops.createBudget({ client, body })),
            get: (budgetId) => unwrap(ops.readBudget({ client, path: { budgetId } })),
            update: (budgetId, body) => unwrap(ops.updateBudget({ client, path: { budgetId }, body })),
            delete: (budgetId) => unwrap(ops.deleteBudget({ client, path: { budgetId } })),
        },
        connectors: {
            list: (query) => unwrap(ops.listConnectors({ client, query })),
            get: (connectorId) => unwrap(ops.readConnector({ client, path: { connectorId } })),
        },
        audit: {
            listRecords: (query) => unwrap(ops.listAuditRecords({ client, query })),
            getRecord: (recordId) => unwrap(ops.readAuditRecord({ client, path: { recordId } })),
        },
        triggers: {
            list: (query) => unwrap(ops.listTriggers({ client, query })),
            create: (body) => unwrap(ops.createTrigger({ client, body })),
            get: (triggerId) => unwrap(ops.readTrigger({ client, path: { triggerId } })),
            update: (triggerId, body) => unwrap(ops.updateTrigger({ client, path: { triggerId }, body })),
            delete: (triggerId) => unwrap(ops.deleteTrigger({ client, path: { triggerId } })),
            listRuns: (triggerId, query) => unwrap(ops.listTriggerRuns({ client, path: { triggerId }, query })),
            createRun: (triggerId, body, options) => unwrap(ops.createTriggerRun({ client, path: { triggerId }, body, headers: options?.headers })),
            getRun: (triggerId, runId) => unwrap(ops.readTriggerRun({ client, path: { triggerId, runId } })),
        },
        sessions: {
            list: (query) => unwrap(ops.listSessions({ client, query })),
            create: (body) => unwrap(ops.createSession({ client, body })),
            get: (sessionId) => unwrap(ops.readSession({ client, path: { sessionId } })),
            update: (sessionId, body) => unwrap(ops.updateSession({ client, path: { sessionId }, body })),
            stream: (sessionId) => createSessionStream(config, sessionId),
            listMessages: (sessionId, query) => unwrap(ops.listSessionMessages({ client, path: { sessionId }, query })),
            createMessage: (sessionId, body) => unwrap(ops.createSessionMessage({ client, path: { sessionId }, body })),
            getMessage: (sessionId, messageId) => unwrap(ops.readSessionMessage({ client, path: { sessionId, messageId } })),
            listEvents: (sessionId, query) => unwrap(ops.listSessionEvents({ client, path: { sessionId }, query })),
            listApprovals: (sessionId) => unwrap(ops.listSessionApprovals({ client, path: { sessionId } })),
            getApproval: (sessionId, approvalId) => unwrap(ops.readSessionApproval({ client, path: { sessionId, approvalId } })),
            decideApproval: (sessionId, approvalId, body) => unwrap(ops.decideSessionApproval({ client, path: { sessionId, approvalId }, body })),
        },
        memoryStores: {
            list: (query) => unwrap(ops.listMemoryStores({ client, query })),
            create: (body) => unwrap(ops.createMemoryStore({ client, body })),
            get: (storeId) => unwrap(ops.readMemoryStore({ client, path: { storeId } })),
            update: (storeId, body) => unwrap(ops.updateMemoryStore({ client, path: { storeId }, body })),
            listMemories: (storeId, query) => unwrap(ops.listMemoryStoreMemories({ client, path: { storeId }, query })),
            createMemory: (storeId, body) => unwrap(ops.createMemoryStoreMemory({ client, path: { storeId }, body })),
            updateMemory: (storeId, memoryId, body) => unwrap(ops.updateMemoryStoreMemory({ client, path: { storeId, memoryId }, body })),
            deleteMemory: (storeId, memoryId) => unwrap(ops.deleteMemoryStoreMemory({ client, path: { storeId, memoryId } })),
        },
        vaults: {
            list: (query) => unwrap(ops.listVaults({ client, query })),
            create: (body) => unwrap(ops.createVault({ client, body })),
            get: (vaultId) => unwrap(ops.readVault({ client, path: { vaultId } })),
            update: (vaultId, body) => unwrap(ops.updateVault({ client, path: { vaultId }, body })),
            listCredentials: (vaultId, query) => unwrap(ops.listVaultCredentials({ client, path: { vaultId }, query })),
            createCredential: (vaultId, body) => unwrap(ops.createVaultCredential({ client, path: { vaultId }, body })),
            getCredential: (vaultId, credentialId) => unwrap(ops.readVaultCredential({ client, path: { vaultId, credentialId } })),
            updateCredential: (vaultId, credentialId, body) => unwrap(ops.updateVaultCredential({ client, path: { vaultId, credentialId }, body })),
            listCredentialVersions: (vaultId, credentialId, query) => unwrap(ops.listVaultCredentialVersions({ client, path: { vaultId, credentialId }, query })),
            createCredentialVersion: (vaultId, credentialId, body) => unwrap(ops.createVaultCredentialVersion({ client, path: { vaultId, credentialId }, body })),
            getCredentialVersion: (vaultId, credentialId, versionId) => unwrap(ops.readVaultCredentialVersion({ client, path: { vaultId, credentialId, versionId } })),
            deleteCredentialVersion: (vaultId, credentialId, versionId) => unwrap(ops.deleteVaultCredentialVersion({ client, path: { vaultId, credentialId, versionId } })),
        },
        usage: {
            listRecords: (query) => unwrap(ops.listUsageRecords({ client, query })),
            getRecord: (recordId) => unwrap(ops.readUsageRecord({ client, path: { recordId } })),
            getSummary: (query) => unwrap(ops.readUsageSummary({ client, query })),
        },
    };
}
export function createAmaRunnerClient(config) {
    const client = createConfiguredClient(config);
    return {
        raw: client,
        configz: {
            get: () => unwrap(ops.readConfigz({ client })),
        },
        runners: {
            list: (query) => unwrap(ops.listRunners({ client, query })),
            create: (body) => unwrap(ops.createRunner({ client, body })),
            get: (runnerId) => unwrap(ops.readRunner({ client, path: { runnerId } })),
            update: (runnerId, body) => unwrap(ops.updateRunner({ client, path: { runnerId }, body })),
            channel: (runnerId) => createRunnerChannel(config, runnerId),
            getHeartbeat: (runnerId) => unwrap(ops.readRunnerHeartbeat({ client, path: { runnerId } })),
            putHeartbeat: (runnerId, body) => unwrap(ops.putRunnerHeartbeat({ client, path: { runnerId }, body })),
        },
        workItems: {
            list: (query) => unwrap(ops.listWorkItems({ client, query })),
            get: (workItemId) => unwrap(ops.readWorkItem({ client, path: { workItemId } })),
        },
        leases: {
            list: (query) => unwrap(ops.listLeases({ client, query })),
            create: (body) => unwrap(ops.createLease({ client, body })),
            get: (leaseId) => unwrap(ops.readLease({ client, path: { leaseId } })),
            update: (leaseId, body) => unwrap(ops.updateLease({ client, path: { leaseId }, body })),
        },
        sessions: {
            createEvents: (sessionId, body) => unwrap(ops.createSessionEvents({ client, path: { sessionId }, body })),
        },
    };
}
