import {
  applicablePolicyLevels,
  canOverrideProviderPolicy as canOverrideProviderPolicyRule,
  effectivePolicyFrom,
  evaluateBudgets,
  evaluateSandboxRuntimeDecision,
  type PolicyDecision,
  type SandboxRuntimeOperation,
  sandboxOperationForRuntimeTool,
  toolPolicyRequiresApproval as toolPolicyRequiresApprovalRule,
} from '@server/domain/policy'
import { createPolicyEvalRepo } from './adapters/repos/policy-eval'
import type { AuthScope } from './usecases/ports'

// The persistence handle the policy engine forwards into its read repo. Typed
// off the repo factory so the engine never imports drizzle directly — the
// repos remain the only drizzle holders.
type PolicyDb = Parameters<typeof createPolicyEvalRepo>[0]

export type { PolicyDecision, SandboxRuntimeOperation }
export { sandboxOperationForRuntimeTool }

// Policy gate for the sandbox executor seam: evaluates command and network
// tool calls against governance sandbox policy and the session environment
// network policy. Returns null when the tool is not a sandbox operation or the
// operation is allowed.
export async function policyBlocksSandboxOperation(
  db: PolicyDb,
  auth: AuthScope,
  values: {
    session: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null
    toolName: string
    input: Record<string, unknown>
  },
): Promise<{ decision: PolicyDecision; operation: SandboxRuntimeOperation } | null> {
  const operation = sandboxOperationForRuntimeTool(values.toolName, values.input)
  if (!operation) {
    return null
  }
  const decision = await evaluateSandboxRuntimePolicy(db, auth, {
    session: values.session,
    operation: operation.operation,
    command: operation.operation === 'command' ? operation.command : null,
    host: operation.operation === 'network' ? operation.host : null,
  })
  if (decision.allowed) {
    return null
  }
  return { decision, operation }
}

// Sensitive sandbox tools can demand a human decision before they execute.
// Symmetric with mcpPolicy.requireApprovalTools, but scoped to the governance
// toolPolicy that gates the cloud sandbox toolset.
export async function toolPolicyRequiresApproval(db: PolicyDb, auth: AuthScope, toolName: string) {
  const effective = await resolveEffectivePolicy(db, auth)
  return toolPolicyRequiresApprovalRule(effective.toolPolicy, toolName)
}

// ─── Policy hierarchy resolution ──────────────────────────────────────────────
//
// Effective governance policy merges organization → team → project scope rows
// with deterministic most-restrictive semantics (the merge + level selection
// live in domain/policy.ts; documented in docs/adr/0006-governance-policy-hierarchy.md). Team rows
// apply only when the caller's OIDC-asserted team memberships include the row's
// team id.

export async function resolveEffectivePolicy(db: PolicyDb, auth: AuthScope) {
  const repo = createPolicyEvalRepo(db)
  const levels = applicablePolicyLevels(await repo.policyLevels(auth), auth.teams ?? [])
  return effectivePolicyFrom(levels)
}

export async function evaluateProviderPolicy(
  db: PolicyDb,
  auth: AuthScope,
  values: {
    providerId: string
    modelId: string | null
  },
): Promise<PolicyDecision> {
  const repo = createPolicyEvalRepo(db)
  const provider = await repo.findProvider(auth.project.id, values.providerId)

  if (provider && !provider.enabled) {
    return {
      allowed: false,
      category: 'provider',
      rule: provider.id,
      message: 'Provider is disabled for this project.',
    }
  }
  if (!provider && values.providerId !== 'workers-ai') {
    return {
      allowed: false,
      category: 'provider',
      rule: values.providerId,
      message: 'Provider is not configured for this project.',
    }
  }
  // Providers bind their credential through a vault secret reference; a
  // revoked or missing credential must fail provider policy evaluation, not
  // only runtime resolution.
  if (provider && !(await repo.providerCredentialUsable(auth, provider))) {
    return {
      allowed: false,
      category: 'provider',
      rule: provider.id,
      message: 'Provider credential is revoked or unavailable.',
    }
  }

  // Budgets live only in the budgets table (docs/api-v1-design.md).
  const budgetDecision = evaluateBudgets(
    await repo.enabledBudgets(auth.project.id),
    await repo.successfulUsage(auth.project.id),
    {
      providerId: values.providerId,
      providerRowId: provider?.id ?? null,
      modelId: values.modelId,
    },
  )
  if (budgetDecision) {
    return budgetDecision
  }

  return { allowed: true, category: 'provider', rule: null, message: 'Allowed by effective policy.' }
}

export function canOverrideProviderPolicy(auth: Pick<AuthScope, 'roles'>) {
  return canOverrideProviderPolicyRule(auth.roles)
}

export interface ProviderPolicySessionDecision {
  decision: PolicyDecision
  // The denied decision an admin explicitly overrode; callers must audit it.
  override: PolicyDecision | null
}

// Session-creation entrypoint for provider policy: evaluates the effective
// provider policy (enablement, credential, budgets) and honors an explicit
// admin override request only for admin-role callers.
export async function evaluateProviderPolicyForSession(
  db: PolicyDb,
  auth: AuthScope,
  values: {
    providerId: string
    modelId: string | null
    adminOverride?: boolean
  },
): Promise<ProviderPolicySessionDecision> {
  const decision = await evaluateProviderPolicy(db, auth, {
    providerId: values.providerId,
    modelId: values.modelId,
  })
  if (decision.allowed || values.adminOverride !== true || !canOverrideProviderPolicy(auth)) {
    return { decision, override: null }
  }
  return {
    decision: {
      allowed: true,
      category: 'override',
      rule: decision.rule,
      message: 'Allowed by explicit admin policy override.',
    },
    override: decision,
  }
}

export async function evaluateMcpToolPolicy(
  db: PolicyDb,
  auth: AuthScope,
  values: {
    connectorId: string
    toolName: string
    session?: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null
  },
): Promise<PolicyDecision> {
  void db
  void auth
  void values
  return { allowed: true, category: 'mcp', rule: null, message: 'Allowed.' }
}

export async function evaluateSandboxRuntimePolicy(
  db: PolicyDb,
  auth: AuthScope,
  values: {
    session?: { id: string; agentSnapshot: string | null; environmentSnapshot: string | null } | null
    operation: 'startup' | 'command' | 'network'
    command?: string | null
    host?: string | null
  },
): Promise<PolicyDecision> {
  const effective = await resolveEffectivePolicy(db, auth)
  return evaluateSandboxRuntimeDecision(effective.sandboxPolicy, values.session ?? null, {
    operation: values.operation,
    command: values.command,
    host: values.host,
  })
}
