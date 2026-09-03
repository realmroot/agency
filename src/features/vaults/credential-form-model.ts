import type { CredentialType } from '@/lib/enborrpc'

export interface CredentialFormState {
  name: string
  type: CredentialType
  data: Record<string, string>
}

export const emptyCredential: CredentialFormState = {
  name: '',
  type: 'opaque',
  data: { value: '' },
}

export const credentialTypes: Array<{ type: CredentialType; label: string }> = [
  { type: 'opaque', label: 'Opaque' },
  { type: 'enbor.dev/basic-auth', label: 'Basic auth' },
  { type: 'enbor.dev/ssh-auth', label: 'SSH auth' },
  { type: 'enbor.dev/tls', label: 'TLS' },
  { type: 'enbor.dev/private-key-jwk', label: 'Private key JWK' },
  { type: 'enbor.dev/oauth-token', label: 'OAuth token' },
]

export function defaultCredentialData(type: CredentialType): Record<string, string> {
  switch (type) {
    case 'opaque':
      return { value: '' }
    case 'enbor.dev/basic-auth':
      return { username: '', password: '' }
    case 'enbor.dev/ssh-auth':
      return { 'ssh-privatekey': '' }
    case 'enbor.dev/tls':
      return { 'tls.crt': '', 'tls.key': '' }
    case 'enbor.dev/private-key-jwk':
      return { jwk: '' }
    case 'enbor.dev/oauth-token':
      return { 'access-token': '', 'refresh-token': '', 'token-type': '', 'expires-at': '', scopes: '' }
    case 'enbor.dev/realmroot-agent-state':
      return { 'state.json': '' }
  }
}

export function credentialSecretData(form: CredentialFormState) {
  return Object.fromEntries(
    Object.entries(form.data)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  )
}

export function hasValidCredentialSecretData(form: CredentialFormState) {
  const data = credentialSecretData(form)
  if (Object.keys(data).length === 0) {
    return false
  }
  return requiredCredentialDataKeys(form.type).every((key) => Boolean(data[key]))
}

function requiredCredentialDataKeys(type: CredentialType) {
  switch (type) {
    case 'opaque':
      return []
    case 'enbor.dev/basic-auth':
      return ['username', 'password']
    case 'enbor.dev/ssh-auth':
      return ['ssh-privatekey']
    case 'enbor.dev/tls':
      return ['tls.crt', 'tls.key']
    case 'enbor.dev/private-key-jwk':
      return ['jwk']
    case 'enbor.dev/oauth-token':
      return ['access-token']
    case 'enbor.dev/realmroot-agent-state':
      return ['state.json']
  }
}
