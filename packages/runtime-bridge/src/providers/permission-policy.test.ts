import { describe, expect, it } from 'vitest'
import { claudeCodePermissionPolicy, codexPermissionPolicy } from './permission-policy'

describe('[spec: runtime/provider-permission-policy] provider permission environment', () => {
  it('preserves the existing provider defaults', () => {
    expect(codexPermissionPolicy({})).toEqual({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
    })
    expect(claudeCodePermissionPolicy({})).toEqual({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    })
  })

  it('accepts provider-supported permission modes', () => {
    expect(
      codexPermissionPolicy({
        ENBOR_CODEX_SANDBOX_MODE: 'workspace-write',
        ENBOR_CODEX_APPROVAL_POLICY: 'on-request',
      }),
    ).toEqual({ sandboxMode: 'workspace-write', approvalPolicy: 'on-request' })
    expect(claudeCodePermissionPolicy({ ENBOR_CLAUDE_CODE_PERMISSION_MODE: 'auto' })).toEqual({
      permissionMode: 'auto',
    })
  })

  it('rejects unsupported values and names the invalid variable', () => {
    expect(() => codexPermissionPolicy({ ENBOR_CODEX_SANDBOX_MODE: 'host-write' })).toThrow(
      'ENBOR_CODEX_SANDBOX_MODE must be one of read-only, workspace-write, danger-full-access',
    )
    expect(() => claudeCodePermissionPolicy({ ENBOR_CLAUDE_CODE_PERMISSION_MODE: 'approve' })).toThrow(
      'ENBOR_CLAUDE_CODE_PERMISSION_MODE must be one of default, acceptEdits, bypassPermissions, plan, dontAsk, auto',
    )
  })
})
