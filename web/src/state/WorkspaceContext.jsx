import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, activeSlice, createInitialState, loadState, reducer } from './workspaceState'
import { isVault, newVaultKey, openVault, sealState } from '../lib/storage/vault'

const WorkspaceContext = createContext(null)

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return null
  }
}

function initial() {
  const raw = readRaw()
  // An encrypted workspace stays locked until the passcode is entered; until
  // then the app holds an empty workspace and saves nothing.
  if (isVault(raw)) return { locked: true, state: createInitialState() }
  return { locked: false, state: loadState(raw) }
}

export function WorkspaceProvider({ children }) {
  const [start] = useState(initial)
  const [state, dispatch] = useReducer(reducer, start.state)
  const [locked, setLocked] = useState(start.locked)
  const [encrypted, setEncrypted] = useState(start.locked)
  const vaultKey = useRef(null)
  const saveSeq = useRef(0)

  useEffect(() => {
    if (locked) return
    const seq = ++saveSeq.current
    const write = (text) => {
      // A slower, older save never overwrites a newer one.
      if (seq !== saveSeq.current) return
      try {
        localStorage.setItem(STORAGE_KEY, text)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch {
        // Quota exceeded -- state still works this session, just won't persist.
      }
    }
    if (vaultKey.current) sealState(state, vaultKey.current).then(write, () => {})
    else write(JSON.stringify(state))
  }, [state, locked])

  const log = (entry) => dispatch({ type: 'LOG_ACTIVITY', entry })

  const security = {
    locked,
    encrypted,
    async unlock(passcode) {
      const { json, vaultKey: key } = await openVault(readRaw(), passcode)
      vaultKey.current = key
      dispatch({ type: 'LOAD', state: loadState(json) })
      setLocked(false)
      setEncrypted(true)
      log({ action: 'Unlocked', purpose: 'Opened M5' })
    },
    // Sets or changes the passcode; the next save is encrypted with it.
    async setPasscode(passcode) {
      vaultKey.current = await newVaultKey(passcode)
      const wasEncrypted = encrypted
      setEncrypted(true)
      log({ action: wasEncrypted ? 'Passcode changed' : 'Passcode set', purpose: 'Encrypt the saved records' })
    },
    lock() {
      if (!vaultKey.current) return
      vaultKey.current = null
      setLocked(true)
      dispatch({ type: 'LOAD', state: createInitialState() })
    },
    // Forgotten passcode: the records can't be recovered, only removed.
    startOver() {
      vaultKey.current = null
      try {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch {
        // nothing saved to remove
      }
      setEncrypted(false)
      setLocked(false)
      dispatch({ type: 'LOAD', state: createInitialState() })
    },
  }

  // Everything below the patient bar sees only the active patient's data.
  const api = {
    ...activeSlice(state),
    patients: state.patients,
    activeId: state.activeId,
    activePatient: state.patients.find((p) => p.id === state.activeId),
    allData: state.data,
    activity: state.activity ?? [],
    security,
    logActivity: log,
    addPatient: (name) => dispatch({ type: 'ADD_PATIENT', name }),
    selectPatient: (id) => dispatch({ type: 'SELECT_PATIENT', id }),
    renamePatient: (id, name) => dispatch({ type: 'RENAME_PATIENT', id, name }),
    movePatient: (id, offset) => dispatch({ type: 'MOVE_PATIENT', id, offset }),
    removePatient: (id) => dispatch({ type: 'REMOVE_PATIENT', id }),
    // fhir: the Bundles the records came from, kept as imported.
    addRecords: (records, fhir) => dispatch({ type: 'ADD_RECORDS', records, fhir }),
    addAssertion: (assertion) => dispatch({ type: 'ADD_ASSERTION', assertion }),
    setFindingDecision: (findingId, status) =>
      dispatch({ type: 'SET_FINDING_DECISION', findingId, status }),
    setGatewayResult: (dataset, result) => dispatch({ type: 'SET_GATEWAY_RESULT', dataset, result }),
    addClaims: (claimsData) => dispatch({ type: 'ADD_CLAIMS', claimsData }),
    setSharing: (domain, value) => dispatch({ type: 'SET_SHARING', domain, value }),
    reset: () => dispatch({ type: 'RESET' }),
  }

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}

// For components that are also shown outside the workspace (in tests, say):
// logs when there is a workspace, does nothing when there isn't.
export function useActivityLogger() {
  return useContext(WorkspaceContext)?.logActivity ?? (() => {})
}
