import { bytesToBase64Url } from '../base64url'

// SMART App Launch, standalone patient launch, as a public browser client
// with PKCE (https://hl7.org/fhir/smart-app-launch/app-launch.html). The app
// sends the person to their health system's sign-in (MyChart for Epic), gets
// a short-lived access token back, and reads their records over FHIR R4.
// Tokens live only in memory; nothing about the connection is stored except
// the one-time PKCE verifier while the person is away signing in.

const PENDING_KEY = 'm5-smart-pending'

// Read access to what M5 can show. SMART v1 scopes, which Epic supports.
export const RESOURCE_SCOPES = [
  'Patient',
  'AllergyIntolerance',
  'Condition',
  'MedicationRequest',
  'Medication',
  'Immunization',
  'Observation',
  'Procedure',
  'Encounter',
  'DiagnosticReport',
  'DocumentReference',
  'Coverage',
  'Device',
]
export const SCOPE = ['openid', 'fhirUser', 'launch/patient', ...RESOURCE_SCOPES.map((r) => `patient/${r}.read`)].join(' ')

export function normalizeBase(url) {
  const trimmed = String(url ?? '').trim()
  if (!/^https:\/\//i.test(trimmed)) throw new Error('Enter the FHIR address, starting with https://')
  return trimmed.replace(/\/+$/, '').replace(/\/metadata$/i, '')
}

export function redirectUri(location = window.location) {
  return `${location.origin}${location.pathname}`
}

async function getJson(url, init, fetchImpl = globalThis.fetch) {
  let res
  try {
    res = await fetchImpl(url, init)
  } catch {
    throw new Error(
      `Your browser could not reach ${new URL(url).host}. The health system may not allow apps that run only in the browser (CORS), or the address is wrong.`,
    )
  }
  if (!res.ok) {
    const err = new Error(`${new URL(url).host} responded ${res.status}.`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// Where to sign in and get tokens: .well-known/smart-configuration, else the
// OAuth URIs in the CapabilityStatement.
export async function discover(iss, fetchImpl) {
  try {
    const c = await getJson(`${iss}/.well-known/smart-configuration`, { headers: { Accept: 'application/json' } }, fetchImpl)
    if (c.authorization_endpoint && c.token_endpoint) return c
  } catch {
    // fall back to the CapabilityStatement
  }
  const cap = await getJson(`${iss}/metadata`, { headers: { Accept: 'application/fhir+json' } }, fetchImpl)
  const uris = cap.rest?.[0]?.security?.extension
    ?.find((e) => e.url === 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris')
    ?.extension ?? []
  const pick = (name) => uris.find((e) => e.url === name)?.valueUri
  if (!pick('authorize') || !pick('token')) throw new Error('This FHIR server does not advertise SMART sign-in.')
  return { authorization_endpoint: pick('authorize'), token_endpoint: pick('token') }
}

function randomString(bytes = 32) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return bytesToBase64Url(new Uint8Array(digest))
}

// healow (eClinicalWorks) also wants the practice code on the sign-in link;
// it's the last part of the FHIR address, as in fhir4.healow.com/fhir/r4/JAFJCD.
export function healowPracticeCode(base) {
  const m = /^https:\/\/fhir4\.healow\.com\/fhir\/r4\/([A-Za-z0-9]+)$/i.exec(base)
  return m ? { practice_code: m[1] } : {}
}

// Builds the sign-in URL and remembers what the callback needs.
export async function beginSignIn({ iss, clientId, label, storage = sessionStorage, location = window.location, fetchImpl }) {
  const base = normalizeBase(iss)
  if (!clientId?.trim()) throw new Error('Enter the client ID from your app registration.')
  const config = await discover(base, fetchImpl)
  const verifier = randomString(48)
  const state = randomString(16)
  const redirect = redirectUri(location)
  storage.setItem(
    PENDING_KEY,
    JSON.stringify({ iss: base, clientId: clientId.trim(), label, state, verifier, tokenEndpoint: config.token_endpoint, redirect }),
  )
  const url = new URL(config.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId.trim(),
    redirect_uri: redirect,
    scope: SCOPE,
    state,
    aud: base,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    ...healowPracticeCode(base),
  }).toString()
  return url.toString()
}

export function pendingCallback(location = window.location) {
  const params = new URLSearchParams(location.search)
  if (!params.get('state') || !(params.get('code') || params.get('error'))) return null
  return params
}

// Finishes sign-in: checks state, trades the code for a token.
export async function completeSignIn(params, { storage = sessionStorage, fetchImpl } = {}) {
  const pending = JSON.parse(storage.getItem(PENDING_KEY) ?? 'null')
  storage.removeItem(PENDING_KEY)
  if (params.get('error')) {
    throw new Error(`Sign-in was not completed: ${params.get('error_description') ?? params.get('error')}.`)
  }
  if (!pending || pending.state !== params.get('state')) {
    throw new Error('This sign-in response does not match one M5 started. Start again from Connect to a provider.')
  }
  const token = await getJson(
    pending.tokenEndpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.get('code'),
        redirect_uri: pending.redirect,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
      }).toString(),
    },
    fetchImpl,
  )
  if (!token.access_token) throw new Error('The health system did not return an access token.')
  if (!token.patient) throw new Error('The health system did not say which patient you signed in as.')
  return { iss: pending.iss, label: pending.label, accessToken: token.access_token, patient: token.patient, scope: token.scope ?? '' }
}

// The searches that make up a record. Epic requires a category on
// Observation and Condition searches; a search the server refuses is noted
// and skipped, not fatal.
export function recordQueries(patient) {
  const p = encodeURIComponent(patient)
  const obs = ['laboratory', 'vital-signs', 'social-history', 'survey'].map((c) => `Observation?patient=${p}&category=${c}`)
  const cond = ['problem-list-item', 'encounter-diagnosis', 'health-concern'].map((c) => `Condition?patient=${p}&category=${c}`)
  return [
    `Patient/${p}`,
    `AllergyIntolerance?patient=${p}`,
    ...cond,
    `MedicationRequest?patient=${p}`,
    `Immunization?patient=${p}`,
    ...obs,
    `Procedure?patient=${p}`,
    `Encounter?patient=${p}`,
    `DiagnosticReport?patient=${p}`,
    `DocumentReference?patient=${p}`,
    `Coverage?patient=${p}`,
    `Device?patient=${p}`,
  ]
}

const MAX_PAGES = 40

// Reads the whole record into one Bundle, following paging links, then
// fetches any Medication a prescription points to that wasn't included.
export async function readRecord({ iss, accessToken, patient }, { fetchImpl, onProgress } = {}) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/fhir+json' }
  const entries = new Map()
  const add = (r) => {
    if (r?.resourceType && r.resourceType !== 'OperationOutcome') entries.set(`${r.resourceType}/${r.id ?? entries.size}`, r)
  }
  const skipped = []
  const queries = recordQueries(patient)
  for (const [i, q] of queries.entries()) {
    onProgress?.({ done: i, total: queries.length, current: q.split('?')[0] })
    let url = `${iss}/${q}`
    try {
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const body = await getJson(url, { headers }, fetchImpl)
        if (body.resourceType === 'Bundle') {
          for (const e of body.entry ?? []) add(e.resource)
          url = body.link?.find((l) => l.relation === 'next')?.url
        } else {
          add(body)
          url = null
        }
      }
    } catch (err) {
      if (q.startsWith('Patient/')) throw err
      skipped.push(`${q.split('?')[0]}${q.includes('category=') ? ` (${q.split('category=')[1]})` : ''}: ${err.status ? `not available (${err.status})` : err.message}`)
    }
  }
  const missingMeds = new Set()
  for (const r of entries.values()) {
    const ref = r.medicationReference?.reference
    if (ref && !ref.startsWith('#') && !entries.has(ref.split('/').slice(-2).join('/'))) missingMeds.add(ref)
  }
  for (const ref of [...missingMeds].slice(0, 200)) {
    try {
      add(await getJson(/^https?:/.test(ref) ? ref : `${iss}/${ref}`, { headers }, fetchImpl))
    } catch {
      // the prescription still shows, by name if it has a display
    }
  }
  onProgress?.({ done: queries.length, total: queries.length })
  return {
    bundle: { resourceType: 'Bundle', type: 'collection', entry: [...entries.values()].map((resource) => ({ resource })) },
    skipped,
  }
}
