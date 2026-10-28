import { describe, expect, it } from 'vitest'
import { beginSignIn, healowPracticeCode, completeSignIn, pkceChallenge, readRecord, recordQueries } from './client'

const ISS = 'https://fhir.example.org/api/FHIR/R4'
const store = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const location = { origin: 'https://crookhaven.github.io', pathname: '/M5-WholeHealth/' }

describe('SMART sign-in', () => {
  it('makes the PKCE challenge from RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('sends the person to sign in with PKCE, aud and patient scopes', async () => {
    const storage = store()
    const fetchImpl = async () => json({ authorization_endpoint: 'https://auth.example.org/authorize', token_endpoint: 'https://auth.example.org/token' })
    const url = new URL(await beginSignIn({ iss: `${ISS}/`, clientId: 'abc', label: 'Test', storage, location, fetchImpl }))
    expect(url.origin + url.pathname).toBe('https://auth.example.org/authorize')
    expect(url.searchParams.get('aud')).toBe(ISS)
    expect(url.searchParams.get('redirect_uri')).toBe('https://crookhaven.github.io/M5-WholeHealth/')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toMatch(/launch\/patient .*patient\/Observation\.read/)
  })

  it('refuses a response whose state does not match', async () => {
    const storage = store()
    storage.setItem('m5-smart-pending', JSON.stringify({ state: 'mine' }))
    await expect(completeSignIn(new URLSearchParams('code=x&state=other'), { storage })).rejects.toThrow(/does not match/)
  })

  it('trades the code for a token with the verifier', async () => {
    const storage = store()
    storage.setItem(
      'm5-smart-pending',
      JSON.stringify({ iss: ISS, clientId: 'abc', label: 'Test', state: 's1', verifier: 'v1', tokenEndpoint: 'https://auth.example.org/token', redirect: 'https://app/' }),
    )
    let sent
    const fetchImpl = async (url, init) => {
      sent = new URLSearchParams(init.body)
      return json({ access_token: 't', patient: 'p1', scope: 'patient/Patient.read' })
    }
    const s = await completeSignIn(new URLSearchParams('code=c1&state=s1'), { storage, fetchImpl })
    expect(sent.get('code_verifier')).toBe('v1')
    expect(sent.get('client_id')).toBe('abc')
    expect(s).toMatchObject({ iss: ISS, accessToken: 't', patient: 'p1' })
  })
})

describe('reading the record', () => {
  it('asks Epic-style searches with categories', () => {
    expect(recordQueries('p1')).toContain('Observation?patient=p1&category=laboratory')
    expect(recordQueries('p1')).toContain('Condition?patient=p1&category=problem-list-item')
  })

  it('follows paging, notes refused searches, and fetches referenced medications', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push(url)
      expect(init.headers.Authorization).toBe('Bearer t')
      if (url.endsWith('/Patient/p1')) return json({ resourceType: 'Patient', id: 'p1' })
      if (url.includes('MedicationRequest?')) {
        return json({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'MedicationRequest', id: 'm1', medicationReference: { reference: 'Medication/x' } } }], link: [{ relation: 'next', url: `${ISS}/page2` }] })
      }
      if (url.endsWith('/page2')) return json({ resourceType: 'Bundle', entry: [{ resource: { resourceType: 'MedicationRequest', id: 'm2' } }] })
      if (url.endsWith('/Medication/x')) return json({ resourceType: 'Medication', id: 'x', code: { text: 'Drug' } })
      if (url.includes('Device?')) return json({}, 403)
      return json({ resourceType: 'Bundle', entry: [] })
    }
    const { bundle, skipped } = await readRecord({ iss: ISS, accessToken: 't', patient: 'p1' }, { fetchImpl })
    const types = bundle.entry.map((e) => `${e.resource.resourceType}/${e.resource.id}`)
    expect(types).toEqual(['Patient/p1', 'MedicationRequest/m1', 'MedicationRequest/m2', 'Medication/x'])
    expect(skipped).toEqual(['Device: not available (403)'])
  })

  it('adds the practice code for healow FHIR addresses only', () => {
    expect(healowPracticeCode('https://fhir4.healow.com/fhir/r4/JAFJCD')).toEqual({ practice_code: 'JAFJCD' })
    expect(healowPracticeCode('https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4')).toEqual({})
  })
})
