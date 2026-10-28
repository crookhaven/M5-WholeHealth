import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../state/WorkspaceContext'
import { beginSignIn, completeSignIn, pendingCallback, readRecord, redirectUri } from '../lib/smart/client'
import { bundleToRecords } from '../lib/openSyntheticPatients'

const PRESETS = [
  {
    label: 'Epic sandbox (test patients)',
    iss: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
    note: 'Use the Non-Production Client ID. Sign in with one of the test MyChart patients listed on fhir.epic.com.',
  },
  { label: 'UVA Health (Epic)', iss: 'https://hscsesoap.hscs.virginia.edu/oauth2/UVAHEALTH/api/FHIR/R4', note: 'Use the Production Client ID.' },
]
const CLIENT_IDS_KEY = 'm5-smart-client-ids'

function storedClientIds() {
  try {
    return JSON.parse(localStorage.getItem(CLIENT_IDS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function patientName(bundle) {
  const p = bundle.entry.map((e) => e.resource).find((r) => r.resourceType === 'Patient')
  const n = p?.name?.find((x) => x.use === 'official') ?? p?.name?.[0]
  return n?.text ?? [n?.given?.join(' '), n?.family].filter(Boolean).join(' ') ?? null
}

// "Connect to a provider": sign in to a health system (Epic MyChart first)
// and import the record straight from its FHIR API.
export default function SmartConnect() {
  const { addRecords, addClaims, addPatient, renamePatient, activeId, sourceRecords, claimsData, security, logActivity } = useWorkspace()
  const [iss, setIss] = useState(PRESETS[0].iss)
  const [clientIds, setClientIds] = useState(storedClientIds)
  const [busy, setBusy] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [skipped, setSkipped] = useState([])
  const handled = useRef(false)
  const preset = PRESETS.find((p) => p.iss === iss)
  const clientId = clientIds[iss] ?? ''

  function setClientId(value) {
    const next = { ...clientIds, [iss]: value }
    setClientIds(next)
    try {
      localStorage.setItem(CLIENT_IDS_KEY, JSON.stringify(next))
    } catch {
      // not remembered; still works this time
    }
  }

  async function signIn() {
    setError(null)
    setBusy('Finding the sign-in page…')
    try {
      window.location.assign(await beginSignIn({ iss, clientId, label: preset?.label ?? new URL(iss).host }))
    } catch (err) {
      setError(err.message)
      setBusy(null)
    }
  }

  // Back from signing in: finish, read the record, import it.
  useEffect(() => {
    const params = pendingCallback()
    if (!params || handled.current) return
    handled.current = true
    window.history.replaceState(null, '', redirectUri())
    ;(async () => {
      setBusy('Signing in…')
      try {
        const session = await completeSignIn(params)
        const { bundle, skipped: notRead } = await readRecord(session, {
          onProgress: ({ done, total, current }) => setBusy(`Reading your record (${done} of ${total})${current ? `: ${current}` : ''}…`),
        })
        const name = patientName(bundle) ?? session.label
        const { records, claimsData: claims } = bundleToRecords(bundle, { sourceType: 'smart-on-fhir', documentName: session.label })
        const empty = sourceRecords.length === 0 && !claimsData
        if (empty) renamePatient(activeId, name)
        else addPatient(name)
        logActivity({ action: 'Connected', detail: `Signed in to ${session.label} and read the record`, purpose: 'Import your record from your provider' })
        addRecords(records, [bundle])
        if (claims) addClaims(claims)
        setSkipped(notRead)
        setStatus(`Imported ${records.length} records for ${name} from ${session.label}${empty ? '' : ' as a new patient'}.`)
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(null)
      }
    })()
    // Runs once, on the page load that carries the sign-in response.
  }, [])

  return (
    <section className="import-section">
      <h2>Connect to a provider</h2>
      <p>
        Sign in to your health system&apos;s patient portal and import your record straight from its FHIR API.
        Your browser talks to the health system directly; the sign-in token is kept only until the import finishes.
      </p>
      <label className="file-label">
        Health system
        <select value={preset ? iss : 'custom'} onChange={(e) => setIss(e.target.value === 'custom' ? '' : e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.iss} value={p.iss}>
              {p.label}
            </option>
          ))}
          <option value="custom">Another FHIR address…</option>
        </select>
      </label>
      {!preset && (
        <label className="file-label">
          FHIR address
          <input type="text" value={iss} onChange={(e) => setIss(e.target.value)} placeholder="https://…/api/FHIR/R4" />
        </label>
      )}
      <label className="file-label">
        Client ID
        <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From your app registration" />
      </label>
      {preset?.note && <p className="section-help">{preset.note}</p>}
      {!security.encrypted && (
        <p className="passcode-required">
          <strong>Set a passcode first</strong>, under Protect your records above. Records from a health system are
          kept in this browser encrypted with it.
        </p>
      )}
      <button type="button" onClick={signIn} disabled={busy !== null || !iss || !clientId || !security.encrypted}>
        {busy ?? 'Sign in and import'}
      </button>
      <p className="section-help">
        Register this address as the app&apos;s redirect URI: <code>{redirectUri()}</code>
      </p>
      {status && <p className="import-message">{status}</p>}
      {skipped.length > 0 && (
        <details>
          <summary>Not imported ({skipped.length})</summary>
          <ul>
            {skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="import-error">{error}</p>}
    </section>
  )
}
