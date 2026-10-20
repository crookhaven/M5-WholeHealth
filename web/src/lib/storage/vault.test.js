import { describe, expect, it } from 'vitest'
import { isVault, newVaultKey, openVault, sealState } from './vault'

describe('vault', () => {
  it('encrypts the workspace so it can only be read with the passcode', async () => {
    const state = { version: 2, patients: [{ id: 'a', name: 'Camila Lopez' }] }
    const raw = await sealState(state, await newVaultKey('correct horse'))
    expect(isVault(raw)).toBe(true)
    expect(raw).not.toContain('Camila')
    const { json } = await openVault(raw, 'correct horse')
    expect(JSON.parse(json)).toEqual(state)
    await expect(openVault(raw, 'wrong passcode')).rejects.toThrow('not right')
  })

  it('keeps the same key for later saves after unlocking', async () => {
    const raw = await sealState({ n: 1 }, await newVaultKey('correct horse'))
    const { vaultKey } = await openVault(raw, 'correct horse')
    const again = await sealState({ n: 2 }, vaultKey)
    expect(JSON.parse((await openVault(again, 'correct horse')).json)).toEqual({ n: 2 })
  })

  it('needs a passcode of at least 8 characters', async () => {
    await expect(newVaultKey('short')).rejects.toThrow('at least 8')
  })

  it('tells plain saves from encrypted ones', () => {
    expect(isVault(null)).toBe(false)
    expect(isVault('{"version":2}')).toBe(false)
    expect(isVault('not json')).toBe(false)
  })
})
