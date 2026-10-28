import { mergeClaimsData } from '../lib/claims/extract'
import { displayText } from '../lib/piqi/attributeTypes'

// The workspace holds several patients (for example a family). Each patient has
// a completely separate set of records, assertions, decisions, sharing choices,
// PIQI results and claims. The rest of the app only ever sees the active
// patient's slice, so screens do not need to know about the others.

export const STORAGE_KEY = 'm5-whole-health-workspace-v1'
// Where workspaces were saved before the rename to M5 Whole Health. Read once
// so nobody loses their data; new saves go to STORAGE_KEY only.
export const LEGACY_STORAGE_KEY = 'm5-health-workspace-v1'
export const STATE_VERSION = 2

export function emptySlice() {
  return {
    sourceRecords: [],
    assertions: [],
    findingDecisions: {},
    sharingSelection: {},
    // Parsed PIQI Gateway results the patient pasted in, one per data set
    // (clinical, ips, claims), linked to records where the data set has them.
    gatewayResults: {},
    // Insurance claims (PIQI PAT_EOB_V1 shape), kept apart from clinical records.
    claimsData: null,
    // The FHIR resources exactly as imported, keyed by fullUrl, so they can be
    // shared as they came (SMART Health Check-in matches them by profile).
    fhirResources: {},
  }
}

// Adds the entries of imported FHIR Bundles, keyed by fullUrl (or type/id).
export function mergeFhirResources(existing, bundles) {
  const out = { ...(existing ?? {}) }
  for (const bundle of bundles ?? []) {
    for (const entry of bundle?.entry ?? []) {
      const resource = entry?.resource
      if (!resource?.resourceType || resource.resourceType === 'OperationOutcome') continue
      const fullUrl = entry.fullUrl || (resource.id ? `${resource.resourceType}/${resource.id}` : null)
      if (!fullUrl) continue
      out[fullUrl] = resource
    }
  }
  return out
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createInitialState() {
  const id = newId()
  return { version: STATE_VERSION, patients: [{ id, name: 'Patient 1' }], activeId: id, data: { [id]: emptySlice() }, activity: [] }
}

// The activity log: who did what with the data, when and why, kept in the
// browser with the records (and encrypted with them when a passcode is set).
const MAX_ACTIVITY = 2000

export function activityEntry(state, { action, detail, purpose, patientId }) {
  const patient = state.patients.find((p) => p.id === (patientId ?? state.activeId))
  return { at: new Date().toISOString(), action, patient: patient?.name ?? null, detail: detail ?? null, purpose: purpose ?? null }
}

function withActivity(state, entry) {
  return { ...state, activity: [...(state.activity ?? []), entry].slice(-MAX_ACTIVITY) }
}

function sourceSummary(records) {
  const source = records[0]?.source
  if (!source) return null
  const label = { 'smart-on-fhir': 'health system (FHIR)', 'smart-health-link': 'SMART Health Link', 'fhir-bundle-upload': 'FHIR file', 'open-synthetic-patients': 'open-synthetic-patients' }[source.type] ?? source.type
  return `${records.length} records from ${label}${source.documentName ? `: ${source.documentName}` : ''}`
}

const DEFAULT_NAME = /^Patient \d+$/

// A person's name from imported demographics, if the records carry one.
export function nameFromRecords(records) {
  const demographics = records.find((r) => r.domain === 'demographics')
  if (!demographics) return undefined
  const first = displayText(demographics.data?.firstName)
  const last = displayText(demographics.data?.lastName)
  const name = [first, last].filter(Boolean).join(' ')
  return name || undefined
}

// Older versions kept a single flat workspace, which becomes the first patient.
export function migrateLegacy(parsed) {
  const { gatewayResult, ...rest } = parsed
  const slice = {
    ...emptySlice(),
    sourceRecords: rest.sourceRecords ?? [],
    assertions: rest.assertions ?? [],
    findingDecisions: rest.findingDecisions ?? {},
    sharingSelection: rest.sharingSelection ?? {},
    gatewayResults: rest.gatewayResults ?? (gatewayResult ? { clinical: gatewayResult } : {}),
    claimsData: rest.claimsData ?? null,
  }
  const id = newId()
  const name = nameFromRecords(slice.sourceRecords) ?? 'Patient 1'
  return { version: STATE_VERSION, patients: [{ id, name }], activeId: id, data: { [id]: slice }, activity: [] }
}

export function loadState(raw) {
  if (!raw) return createInitialState()
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version === STATE_VERSION && Array.isArray(parsed.patients) && parsed.patients.length > 0) {
      const activeId = parsed.patients.some((p) => p.id === parsed.activeId) ? parsed.activeId : parsed.patients[0].id
      const data = {}
      for (const p of parsed.patients) data[p.id] = { ...emptySlice(), ...(parsed.data?.[p.id] ?? {}) }
      return { version: STATE_VERSION, patients: parsed.patients, activeId, data, activity: Array.isArray(parsed.activity) ? parsed.activity : [] }
    }
    return migrateLegacy(parsed ?? {})
  } catch {
    return createInitialState()
  }
}

export function activeSlice(state) {
  return state.data[state.activeId]
}

function updateActive(state, fn) {
  return { ...state, data: { ...state.data, [state.activeId]: fn(activeSlice(state)) } }
}

function nextDefaultName(patients) {
  let n = patients.length + 1
  while (patients.some((p) => p.name === `Patient ${n}`)) n++
  return `Patient ${n}`
}

// Changes to the records are logged as they happen.
export function reducer(state, action) {
  const next = baseReducer(state, action)
  if (next === state) return next
  switch (action.type) {
    case 'ADD_RECORDS':
      return withActivity(next, activityEntry(next, { action: 'Imported', detail: sourceSummary(action.records), purpose: 'Added to the record' }))
    case 'ADD_CLAIMS':
      return withActivity(next, activityEntry(next, { action: 'Imported', detail: `${action.claimsData?.claims?.length ?? 0} insurance claims`, purpose: 'Added to the record' }))
    case 'ADD_ASSERTION':
      return withActivity(next, activityEntry(next, { action: 'Changed', detail: `Your correction to ${action.assertion?.field ?? 'a record'}`, purpose: 'Correction by you' }))
    case 'REMOVE_PATIENT':
      return withActivity(next, activityEntry(state, { action: 'Deleted', detail: 'All records for this patient', purpose: 'Deleted by you', patientId: action.id }))
    case 'LOG_ACTIVITY':
      return next
    default:
      return next
  }
}

function baseReducer(state, action) {
  switch (action.type) {
    case 'LOG_ACTIVITY':
      return withActivity(state, activityEntry(state, action.entry))
    case 'LOAD':
      return action.state
    case 'ADD_RECORDS': {
      const next = updateActive(state, (s) => ({
        ...s,
        sourceRecords: [...s.sourceRecords, ...action.records],
        ...(action.fhir?.length ? { fhirResources: mergeFhirResources(s.fhirResources, action.fhir) } : {}),
      }))
      // An unnamed patient takes the name found in imported demographics.
      const active = state.patients.find((p) => p.id === state.activeId)
      const found = active && DEFAULT_NAME.test(active.name) ? nameFromRecords(action.records) : undefined
      if (!found) return next
      return { ...next, patients: next.patients.map((p) => (p.id === active.id ? { ...p, name: found } : p)) }
    }
    case 'ADD_ASSERTION':
      return updateActive(state, (s) => ({ ...s, assertions: [...s.assertions, action.assertion] }))
    case 'SET_FINDING_DECISION':
      return updateActive(state, (s) => ({
        ...s,
        findingDecisions: {
          ...s.findingDecisions,
          [action.findingId]: { status: action.status, decidedAt: new Date().toISOString() },
        },
      }))
    case 'SET_SHARING':
      return updateActive(state, (s) => ({ ...s, sharingSelection: { ...s.sharingSelection, [action.domain]: action.value } }))
    case 'SET_GATEWAY_RESULT':
      return updateActive(state, (s) => ({ ...s, gatewayResults: { ...s.gatewayResults, [action.dataset]: action.result } }))
    case 'ADD_CLAIMS':
      return updateActive(state, (s) => ({ ...s, claimsData: mergeClaimsData(s.claimsData, action.claimsData) }))
    case 'ADD_PATIENT': {
      const id = newId()
      const name = action.name?.trim() || nextDefaultName(state.patients)
      return {
        ...state,
        patients: [...state.patients, { id, name }],
        activeId: id,
        data: { ...state.data, [id]: emptySlice() },
      }
    }
    case 'SELECT_PATIENT':
      return state.data[action.id] ? { ...state, activeId: action.id } : state
    case 'MOVE_PATIENT': {
      // Moves a patient up (offset -1) or down (+1) in the list; the order is
      // the patient dropdown's and the Family tab's.
      const from = state.patients.findIndex((p) => p.id === action.id)
      const to = from + action.offset
      if (from === -1 || to < 0 || to >= state.patients.length) return state
      const patients = [...state.patients]
      const [moved] = patients.splice(from, 1)
      patients.splice(to, 0, moved)
      return { ...state, patients }
    }
    case 'RENAME_PATIENT': {
      const name = action.name?.trim()
      if (!name) return state
      return { ...state, patients: state.patients.map((p) => (p.id === action.id ? { ...p, name } : p)) }
    }
    case 'REMOVE_PATIENT': {
      if (!state.data[action.id]) return state
      if (state.patients.length === 1) {
        // The last patient is cleared rather than removed.
        return { ...state, data: { [action.id]: emptySlice() } }
      }
      const patients = state.patients.filter((p) => p.id !== action.id)
      const data = { ...state.data }
      delete data[action.id]
      return { ...state, patients, data, activeId: state.activeId === action.id ? patients[0].id : state.activeId }
    }
    case 'RESET':
      return createInitialState()
    default:
      return state
  }
}
