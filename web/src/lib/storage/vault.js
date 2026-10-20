import { base64UrlToBytes, bytesToBase64Url } from '../base64url'

// Encrypts the saved workspace with a key made from the person's passcode, so
// records are encrypted at rest in the browser. AES-256-GCM, with the key
// derived by PBKDF2-SHA-256 (600,000 rounds, random salt). The key is never
// stored; it lives in memory only while M5 is unlocked.

const ITERATIONS = 600000
export const MIN_PASSCODE_LENGTH = 8

export function isVault(raw) {
  if (!raw) return false
  try {
    return JSON.parse(raw)?.m5vault === 1
  } catch {
    return false
  }
}

export async function deriveKey(passcode, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function newVaultKey(passcode) {
  if ((passcode ?? '').length < MIN_PASSCODE_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSCODE_LENGTH} characters.`)
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { key: await deriveKey(passcode, salt), salt }
}

export async function sealState(state, { key, salt }) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(state))))
  return JSON.stringify({ m5vault: 1, salt: bytesToBase64Url(salt), iv: bytesToBase64Url(iv), data: bytesToBase64Url(data) })
}

// Returns the saved state and the key, or throws if the passcode is wrong.
export async function openVault(raw, passcode) {
  const vault = JSON.parse(raw)
  const salt = base64UrlToBytes(vault.salt)
  const key = await deriveKey(passcode, salt)
  let plain
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(vault.iv) }, key, base64UrlToBytes(vault.data))
  } catch {
    throw new Error('That passcode is not right.')
  }
  return { json: new TextDecoder().decode(plain), vaultKey: { key, salt } }
}
