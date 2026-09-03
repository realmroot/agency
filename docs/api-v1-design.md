# AMA API v1 设计规范

本文档是 API v1 全量重写的唯一准绳。所有路由、schema、调用方改造以此为准。
v1 不兼容旧版（旧路径全部删除，无兼容层）。

## 1. 全局约定

### 1.1 基础

- 所有接口挂载在 `/api/v1` 下，全部进 OpenAPI 文档。
- 资源名：复数 kebab-case。字段名：camelCase。enum 值：snake_case
  （外部标识符例外：provider type 如 `workers-ai` 保持 kebab）。
- 认证：Realmroot OIDC，Console 与 runner 使用 Bearer，Agent 与 Toolbox 使用 RFC 9449 DPoP；凭据模式由已验证的 OAuth `client_id` 严格区分。租户由
  认证上下文 + `X-AMA-Project-ID` 头限定，资源路径不再嵌套 project。

### 1.2 严格 REST 规则（无例外条款见 1.8）

1. URI 只能是名词资源，不得出现动词（无 /export、/stop、/validate…）。
2. POST 仅用于创建；创建成功返回 `201` + 资源体，资源必须可寻址（事后可 GET）。
3. PUT 用于幂等整体替换 / upsert；PATCH 用于部分更新与状态迁移。
4. DELETE 只用于真删除：删除后该 URI GET 404。
5. **归档不是 DELETE**：所有软删一律 `PATCH {archived: true}`。
6. 导出与流式走内容协商：同一集合 URI 上 `Accept: text/csv` /
   `text/event-stream`，不再有专用路径。
7. 异步动作 = 任务资源：`POST /xxx-tasks` → 201 + Location，可 GET 查状态。
8. 无副作用的"评估/查询"必须是 GET（带查询参数），不得用 POST。

### 1.2.1 资源响应结构

除 Project、Provider、Connector、Runner、Lease、WorkItem、Usage、Audit 等保留各自领域结构的资源外，核心可变产品资源统一使用和 Session 一致的实体形状：

```ts
{
  metadata: {
    uid: string
    pid: string | null
    name: string
    description: string | null
    labels: Record<string, string>
    annotations: Record<string, string>
    createdBy: string | null
    createdAt: string
    updatedAt: string
    archivedAt: string | null
  }
  spec: object
  status: object
}
```

适用资源包括 `Agent`、`AgentVersion`、`AgentMemory`、`Environment`、
`EnvironmentVersion`、`Vault`、`VaultCredential`、`VaultCredentialVersion`、
`MemoryStore`、`MemoryStoreMemory`、`Trigger`、`TriggerRun`。稳定资源 id 一律
是 `metadata.uid`，响应顶层不得再暴露兼容用的 `id`、`projectId`、`name`、
`description`、`archivedAt` 或 `version`。创建和更新请求体仍然使用业务字段，
不要求调用方提交 `metadata/spec/status`。

### 1.3 状态机分离

每个资源最多两个状态维度，永不混用：

- `status.phase` 或历史保留的 `state`：运行/运营状态（如 session 的
  `pending|running|idle|stopped|error`）。
- `metadata.archivedAt: string|null`：生命周期。`null` = 活跃。标准资源的
  `status.phase` 可派生为 `active|archived`，但业务 enum 里不得出现 `deleted`。
- 运营开关用布尔（如 trigger 的 `spec.suspend`，替代 `paused`）。

### 1.4 凭据引用统一

唯一机制：Vault 体系。控制面资源选择用
`credentialRef: { credentialId }`；运行时输入、envFrom、volume
挂载用 URL 形态 `secretRef`，例如
`ama://vaults/{vaultId}/credentials/{credentialId}` 或
`ama://vaults/{vaultId}`。
废除：`credentialSecretRef`（Provider/Runner 裸字符串）、`secretRefs`
（Environment）、`vaultRefs`（Session）、`runtimeSecretEnv[].ref` 裸字符串。

### 1.5 分页与列表

- 列表信封：`{ data: T[], pagination: { limit, hasMore, nextCursor } }`。
- 删除旧版 `firstId/lastId/firstSequence/lastSequence`（events 的 `sequence`
  只存在于 event item 上）。

### 1.6 错误结构

`{ error: { type, message, issues?, details? } }`（沿用旧版，不变）。

### 1.7 schema 通用规则

- 删除所有响应中的 `organizationId`（projectId 已决定 organization）。
- 删除实现细节字段：`durableObjectName`、`sandboxId`、`runtimeEndpointPath`
  （DB 内部列可保留，不进 API schema）。
- 禁止 `any` 类型黑洞：`AuthSession`、`UsageSummary.totals` 等补全类型。
- Session 与 Trigger 复用同一组运行输入字段：`runtime`、`env`、`envFrom`、
  `volumes`、`volumeMounts`。Trigger 不定义第二套环境变量、secret 或 volume
  结构。
- 版本资源也使用标准资源形状；Session status 里保留不可变 agent/environment
  快照，外部资源读写仍通过对应版本资源完成。

### 1.8 豁免清单（唯一允许偏离 REST 的地方）

- `/api/auth/*` 命名空间前缀：认证与联邦域（与 IdP 的边界 + 与顶级
  /sessions 撞词的隔离）。域内端点本身仍是 REST 资源。
- WebSocket 升级：`GET /leases/{id}/channel` → 101。WS 握手协议本身就是
  GET，名词资源，不算违例。
- 外部协议适配面（不进 v1 spec，类比"不是我们管辖的 API"）：
  - `/runtime/sessions/{sessionId}/*`：会话运行时代理（隧道 ACP 等协议）。
  - `/api/e2e/*`：`AMA_E2E_TEST_AUTH` 门控的测试端点。

## 2. 路径总表

### Auth（认证与联邦域）

```
GET              /api/v1/auth/config                      OIDC 发现配置（公开；?organization=）
GET              /api/v1/auth/sessions/current            当前会话上下文 {user, organization, project}
```

### Projects

```
GET|POST         /api/v1/projects
GET|DELETE       /api/v1/projects/{projectId}             DELETE 仅允许空且非 Default 的 Project（否则 409）
```

每个租户恰有一个由系统维护的 `Default` Project。`Default` 是保留名称，
不能通过 Projects API 创建、修改或删除；数据库唯一约束保证并发请求也不能产生第二个。

### Agents

```
GET|POST         /api/v1/agents
GET|PATCH        /api/v1/agents/{agentId}                 归档 = PATCH {archived:true}
GET|PUT          /api/v1/agents/{agentId}/memory          单例，PUT 整体替换
GET              /api/v1/agents/{agentId}/versions
GET              /api/v1/agents/{agentId}/versions/{version}
GET              /api/v1/agents/{agentId}/handoff-candidates
```

Agent 响应结构：`metadata` 存放 uid、显示名、描述、时间戳和归档时间；
`spec` 存放 `instructions`、`providerId`、`model`、`skills`、`tools[]`、
`mcpConnectors`、handoff/memory policy 等运行配置；`status` 存放
`currentVersionId`、当前版本号和生命周期 phase。旧 `provider`、`systemPrompt`、
`allowedTools`、顶层 `status`、顶层 `archivedAt` 不进响应。

### Environments

```
GET|POST         /api/v1/environments
GET|PATCH        /api/v1/environments/{environmentId}
GET              /api/v1/environments/{environmentId}/versions[/{version}]
```

Environment 响应结构：`metadata` 存放 uid、显示名、描述、时间戳和归档时间；
`spec` 存放 packages、variables、hostingMode、network/MCP/package/resource policy、
runtimeConfig 和 metadata；`status` 存放 `currentVersionId`、当前版本号和
生命周期 phase。不再保存环境级 secret 引用；运行时 secret 通过 Session/Trigger
`envFrom` 或 `volumes` 挂载。

### Providers

```
GET|POST         /api/v1/providers
GET|PATCH|DELETE /api/v1/providers/{providerId}           DELETE 真删（404 after）
GET              /api/v1/providers/{providerId}/models
PUT|DELETE       /api/v1/providers/{providerId}/models/{modelId}    upsert/删除
POST             /api/v1/providers/{providerId}/model-discovery-tasks    → 201
GET              /api/v1/providers/{providerId}/model-discovery-tasks/{taskId}
```

schema：删 `hasCredential`、`credentialSecretRef`；增 `credentialRef`；
`status` 整个删除，运营开关 = `enabled: boolean`（§1.3）；`modelCatalogStatus`
→ `modelCatalogState`。Budget 同理：`status` → `enabled: boolean`。

### Sessions

```
GET|POST         /api/v1/sessions
GET|PATCH        /api/v1/sessions/{sessionId}             PATCH 可改 name/metadata/
                                                          state(→stopped)/archived
GET              /api/v1/sessions/{sessionId}/socket      浏览器 WebSocket upgrade
GET|POST         /api/v1/sessions/{sessionId}/messages    原 commands；POST → 201
GET              /api/v1/sessions/{sessionId}/messages/{messageId}   投递状态可查
GET              /api/v1/sessions/{sessionId}/events      Accept: application/json |
                                                          text/csv | text/event-stream
POST             /api/v1/sessions/{sessionId}/events      runner 批量上报 → 201（lease 鉴权）
GET              /api/v1/sessions/{sessionId}/approvals
GET|PATCH        /api/v1/sessions/{sessionId}/approvals/{approvalId}
                                                          决策 = PATCH {decision}；
                                                          Approval.state: pending|approved|denied
```

删除：`POST /stop`、`DELETE`、`/reconnect`、`/events/export`、`/events/stream`、
`/commands`。schema 按 1.3/1.4/1.7 改造，执行规格收进 `executionSpec`。

### Triggers（原 scheduled-agent-triggers）

```
GET|POST         /api/v1/triggers
GET|PATCH        /api/v1/triggers/{triggerId}             paused → enabled:boolean；归档 = PATCH
GET|POST         /api/v1/triggers/{triggerId}/runs        POST 仅 HTTP trigger 创建 run
GET              /api/v1/triggers/{triggerId}/runs/{runId}
POST             /api/v1/inbox-notifications                     Inbox Subscription callback receipt
```

### Vaults

```
GET|POST         /api/v1/vaults
GET|PATCH        /api/v1/vaults/{vaultId}                 归档 = PATCH
GET|POST         /api/v1/vaults/{vaultId}/credentials
GET|PATCH|PUT    /api/v1/vaults/{vaultId}/credentials/{credentialId}    PUT 更新 secret；PATCH 吊销/metadata
GET              /api/v1/vaults/{vaultId}/credentials/{credentialId}/versions
GET              /api/v1/vaults/{vaultId}/credentials/{credentialId}/versions/{versionId}
```

### Connectors

```
GET              /api/v1/connectors[/{connectorId}]       平台 MCP server 目录；id 唯一标识
```

MCP 凭证走 Vault credential，session runtime manifest 只引用 connector id 和
credential metadata。AMA 不暴露 connection 资源，也不代理 MCP tool call。

### Budgets

```
GET|POST         /api/v1/budgets
GET|PATCH|DELETE /api/v1/budgets/{budgetId}
```

删除：`/governance/config`、`/config/preview`、`/config/validate`、`access-rules`、
公开 `policies` 和 `POST /policy-evaluations`。治理/policy 规则先保持内部能力，
不作为 public API 资源暴露。

### Usage / Audit（只读）

```
GET              /api/v1/usage-records[/{recordId}]       Accept: text/csv 即导出
GET              /api/v1/usage-summary                    ?groupBy=provider|model|agent&from=&to=
GET              /api/v1/audit-records[/{recordId}]       Accept: text/csv 即导出
```

### Runners / 工作队列

```
GET|POST         /api/v1/runners
GET|PATCH        /api/v1/runners/{runnerId}               归档/下线 = PATCH
GET|PUT          /api/v1/runners/{runnerId}/heartbeat     单例"当前活性状态"，PUT 幂等替换
GET              /api/v1/work-items                       顶级只读队列；?state=available
GET              /api/v1/work-items/{workItemId}
GET|POST         /api/v1/leases                           领活 = POST {workItemId, runnerId}
                                                          → 201；竞态 → 409；"没活" = GET
                                                          work-items 空列表
GET|PATCH        /api/v1/leases/{leaseId}                 续租 = PATCH {expiresAt}；完结 =
                                                          PATCH {state, result|error}（服务端落回
                                                          work-item；Lease 不再内嵌 workItem，
                                                          改 workItemId）
GET              /api/v1/leases/{leaseId}/channel         双向通道，WS 升级（豁免见 1.8）
```

领活流程：`GET /work-items?state=available` → `POST /leases` → 409 重试。
事件上报走 `POST /sessions/{id}/events`（lease 鉴权）。

## 3. 删除清单（旧版彻底移除）

- `/api/auth/session`（单数）、`/api/auth/login-options`
- `/api/projects/{id}/external-bindings`
- 所有资源的 `DELETE`-as-archive 行为
- `/api/governance/*` 整个命名空间
- `/api/mcp/*` 整个命名空间
- `/api/usage`、`/api/usage/summary`、`/api/usage/export`
- `/api/audit-records/export`
- `/api/runners/work-items`、`/api/runners/{id}/heartbeats`、
  `/api/runners/{id}/leases/*`
- `/api/scheduled-agent-triggers/*`
- `/api/sessions/{id}/stop|reconnect|commands|events/export|events/stream`、
  `POST /approvals/{id}`
- `POST /api/providers/{id}/models`（upsert-via-POST）、`/models/discovery`
- schema 字段：`organizationId`（响应中）、`durableObjectName`、`sandboxId`、
  `runtimeEndpointPath`、`hasCredential`、`credentialSecretRef`、`secretRefs`、
  `vaultRefs`、`systemPrompt`、`allowedTools`、旧资源响应顶层
  `id|projectId|name|description|archivedAt|version`、`status` 中的
  `deleted|paused` 值、分页 first/last 字段
