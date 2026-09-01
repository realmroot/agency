const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const
const CODEX_APPROVAL_POLICIES = ['never', 'on-request', 'on-failure', 'untrusted'] as const
const CLAUDE_CODE_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'] as const

function environmentChoice<const Values extends readonly string[]>(
  env: NodeJS.ProcessEnv,
  name: string,
  values: Values,
  fallback: Values[number],
): Values[number] {
  const configured = env[name]?.trim()
  if (!configured) return fallback
  if (values.includes(configured as Values[number])) return configured as Values[number]
  throw new Error(`${name} must be one of ${values.join(', ')}; received ${JSON.stringify(configured)}`)
}

export function codexPermissionPolicy(env: NodeJS.ProcessEnv = process.env) {
  return {
    sandboxMode: environmentChoice(env, 'AMA_CODEX_SANDBOX_MODE', CODEX_SANDBOX_MODES, 'danger-full-access'),
    approvalPolicy: environmentChoice(env, 'AMA_CODEX_APPROVAL_POLICY', CODEX_APPROVAL_POLICIES, 'never'),
  }
}

export function claudeCodePermissionPolicy(env: NodeJS.ProcessEnv = process.env) {
  const permissionMode = environmentChoice(
    env,
    'AMA_CLAUDE_CODE_PERMISSION_MODE',
    CLAUDE_CODE_PERMISSION_MODES,
    'bypassPermissions',
  )
  return permissionMode === 'bypassPermissions'
    ? { permissionMode, allowDangerouslySkipPermissions: true as const }
    : { permissionMode }
}
