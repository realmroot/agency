import type { CredentialType } from '@/lib/amarpc'

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
  { type: 'ama.dev/basic-auth', label: 'Basic auth' },
  { type: 'ama.dev/ssh-auth', label: 'SSH auth' },
  { type: 'ama.dev/tls', label: 'TLS' },
  { type: 'ama.dev/private-key-jwk', label: 'Private key JWK' },
  { type: 'ama.dev/oauth-token', label: 'OAuth token' },
]

export function defaultCredentialData(type: CredentialType): Record<string, string> {
  switch (type) {
    case 'opaque':
      return { value: '' }
    case 'ama.dev/basic-auth':
      return { username: '', password: '' }
    case 'ama.dev/ssh-auth':
      return { 'ssh-privatekey': '' }
    case 'ama.dev/tls':
      return { 'tls.crt': '', 'tls.key': '' }
    case 'ama.dev/private-key-jwk':
      return { jwk: '' }
    case 'ama.dev/oauth-token':
      return { 'access-token': '', 'refresh-token': '', 'token-type': '', 'expires-at': '', scopes: '' }
    case 'ama.dev/realmroot-agent-state':
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
    case 'ama.dev/basic-auth':
      return ['username', 'password']
    case 'ama.dev/ssh-auth':
      return ['ssh-privatekey']
    case 'ama.dev/tls':
      return ['tls.crt', 'tls.key']
    case 'ama.dev/private-key-jwk':
      return ['jwk']
    case 'ama.dev/oauth-token':
      return ['access-token']
    case 'ama.dev/realmroot-agent-state':
      return ['state.json']
  }
}
