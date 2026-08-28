import type { Env } from '../env'

interface EncryptedValue {
  version: 'v1'
  algorithm: 'AES-GCM'
  iv: string
  ciphertext: string
}

export async function encryptWebSessionValue(env: Env, value: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await webSessionKey(env),
    new TextEncoder().encode(value),
  )
  return JSON.stringify({
    version: 'v1',
    algorithm: 'AES-GCM',
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  } satisfies EncryptedValue)
}

export async function decryptWebSessionValue(env: Env, serialized: string, context: string) {
  let encrypted: EncryptedValue
  try {
    encrypted = JSON.parse(serialized) as EncryptedValue
  } catch {
    throw new Error('Web session ciphertext is invalid')
  }
  if (
    encrypted.version !== 'v1' ||
    encrypted.algorithm !== 'AES-GCM' ||
    typeof encrypted.iv !== 'string' ||
    typeof encrypted.ciphertext !== 'string'
  ) {
    throw new Error('Web session ciphertext is invalid')
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlDecode(encrypted.iv),
        additionalData: new TextEncoder().encode(context),
      },
      await webSessionKey(env),
      base64UrlDecode(encrypted.ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new Error('Web session ciphertext failed authenticated decryption')
  }
}

export async function hashOpaqueValue(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function hashWebSessionClientAddress(env: Env, address: string) {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await derivedKey(env, 'client-rate-limit', 'HMAC'),
    new TextEncoder().encode(address),
  )
  return base64UrlEncode(new Uint8Array(signature))
}

export function randomOpaqueValue() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

async function webSessionKey(env: Env) {
  return derivedKey(env, 'aes-gcm', 'AES-GCM')
}

async function derivedKey(env: Env, purpose: string, algorithm: 'AES-GCM' | 'HMAC') {
  const secret = env.AMA_WEB_SESSION_ENCRYPTION_KEY
  if (!secret || secret.length < 32) {
    throw new Error('AMA_WEB_SESSION_ENCRYPTION_KEY with at least 32 characters is required for browser sessions')
  }
  const master = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('ama-web-session-v1'),
      info: new TextEncoder().encode(purpose),
    },
    master,
    algorithm === 'AES-GCM' ? { name: 'AES-GCM', length: 256 } : { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    algorithm === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['sign'],
  )
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url value')
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
