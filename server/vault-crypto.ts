import type { Env } from './env'

const ENCRYPTION_VERSION = 'v1'

export interface EncryptedSecretValue {
  version: typeof ENCRYPTION_VERSION
  algorithm: 'AES-GCM'
  iv: string
  ciphertext: string
}

export async function encryptSecretValue(env: Env, value: string): Promise<EncryptedSecretValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await vaultEncryptionKey(env)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
  return {
    version: ENCRYPTION_VERSION,
    algorithm: 'AES-GCM',
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  }
}

export async function decryptSecretValue(env: Env, encrypted: unknown): Promise<string | null> {
  if (!isEncryptedSecretValue(encrypted)) {
    return null
  }
  const key = await vaultEncryptionKey(env)
  const iv = base64UrlDecode(encrypted.iv)
  const ciphertext = base64UrlDecode(encrypted.ciphertext)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  } catch {
    // AES-GCM authentication failed. Surface a safe error without echoing
    // ciphertext, key material, or platform error internals.
    throw new Error('Vault ciphertext failed authenticated decryption')
  }
  return new TextDecoder().decode(plaintext)
}

function isEncryptedSecretValue(value: unknown): value is EncryptedSecretValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    record.version === ENCRYPTION_VERSION &&
    record.algorithm === 'AES-GCM' &&
    typeof record.iv === 'string' &&
    typeof record.ciphertext === 'string'
  )
}

async function vaultEncryptionKey(env: Env) {
  const secret = env.VAULT_ENCRYPTION_KEY
  if (!secret || secret.length < 32) {
    throw new Error('VAULT_ENCRYPTION_KEY with at least 32 characters is required for vault credential storage')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
