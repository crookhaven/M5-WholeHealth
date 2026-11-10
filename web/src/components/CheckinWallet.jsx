import { useEffect, useState, useSyncExternalStore } from 'react'
import { useWorkspace } from '../state/WorkspaceContext'
import { walletSession } from '../lib/checkin/session'
import { buildResponse, declineAll, describeResource, patientEntry, prepareItems, walletEntries } from '../lib/checkin/respond'
import { missingRequired } from '../lib/checkin/forms'
import { asForm, formFromPrefill, pendingReview, responseItems, wantsPrefill } from '../lib/checkin/formState'
import CheckinForm from './CheckinForm'
import { displayOrder } from '../lib/checkin/order'
import { CHECKIN_TEST_PATIENT, bundleToRecords, fetchFromGitHub } from '../lib/openSyntheticPatients'

// M5 as a SMART Health Check-in web wallet: a check-in page opens M5 with
// ?checkin and asks for records and forms; the patient picks what to share,
// item by item, and M5 sends it back encrypted to that page only.

// Plain words for where a prefilled answer came from.
const SOURCE_WORDS = {
  Patient: 'details',
  AllergyIntolerance: 'allergy list',
  MedicationRequest: 'medication list',
  MedicationStatement: 'medication list',
  Condition: 'health problems',
  Immunization: 'vaccinations',
  Coverage: 'insurance',
  RelatedPerson: 'contacts',
  FamilyMemberHistory: 'family history',
  Observation: 'health record',
}

function describeSources(refs) {
  const words = [...new Set(refs.map((r) => SOURCE_WORDS[r.split('/')[0]] ?? 'records'))]
  return words.join(' and ')
}

// The heading of the form section a review unit sits in: "Allergies".
function sectionTitle(questionnaire, unit) {
  const linkId = unit.startsWith('top:') ? unit.slice(4) : unit.replace(/#\d+\/$/, '').split('/').pop().replace(/#\d+$/, '')
  const walk = (items = []) => {
    for (const i of items) {
      if (i.linkId === linkId) return i.text ?? linkId
      const found = walk(i.item)
      if (found) return found
    }
    return null
  }
  return walk(questionnaire.item) ?? linkId
}

function feedsNote(uses) {
  return [...uses]
    .map(([title, sections]) => {
      const list = [...sections]
      const names = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]
      return `These records filled in the ${names} ${list.length > 1 ? 'sections' : 'section'} of "${title}" above.`
    })
    .join(' ')
}

const typeId = (r) => (r?.resourceType && r.id ? `${r.resourceType}/${r.id}` : null)

// The records shared in other items that a form entry came from, as
// { itemId: [fullUrl] }.
function recordsFor(prepared, refs) {
  const out = {}
  for (const p of prepared ?? []) {
    if (p.kind !== 'selection') continue
    const hits = p.records.filter((e) => refs.includes(typeId(e.resource))).map((e) => e.fullUrl)
    if (hits.length) out[p.item.id] = hits
  }
  return out
}

function ItemCard({ p, shared, onShare, form, onForm, skipped, notes = new Map(), feeds = null, left = new Set(), onLeave }) {
  const { item } = p
  const matches = p.kind === 'selection' ? p.records : []
  const kept = matches.filter((e) => !left.has(e.fullUrl)).length
  const shareable = p.kind === 'form' || matches.length > 0
  return (
    <section className={`checkin-item${shareable ? '' : ' checkin-item-none'}`}>
      <label className="checkin-item-head">
        <input type="checkbox" checked={shareable && shared} disabled={!shareable} onChange={(e) => onShare(e.target.checked)} />
        <span>
          <strong>{item.title}</strong>
          {item.required && <span className="checkin-needed"> · the website says it needs this</span>}
          {item.summary && <span className="checkin-summary">{item.summary}</span>}
        </span>
      </label>
      {p.kind === 'unsupported' && <p className="section-help">M5 can&apos;t answer this: {p.reason}</p>}
      {p.kind === 'selection' && matches.length === 0 && (
        <p className="section-help">Nothing in this person&apos;s records matches, so M5 will say none is available.</p>
      )}
      {p.kind === 'selection' && feeds && <p className="section-help">{feeds}</p>}
      {p.kind === 'selection' && matches.some((e) => notes.has(e.fullUrl)) && (
        <p className="checkin-note">
          You changed or removed {matches.filter((e) => notes.has(e.fullUrl)).length} of these in a form. Open the list to see which.
        </p>
      )}
      {p.kind === 'selection' && matches.length > 0 && (
        <details>
          <summary>
            {shared && kept < matches.length
              ? `${kept} of ${matches.length} records ticked`
              : `${matches.length} ${matches.length === 1 ? 'record' : 'records'}`}
            {shared && matches.length > 1 && ' (open to choose which)'}
          </summary>
          <ul className="checkin-records">
            {matches.map((e) => (
              <li key={e.fullUrl}>
                <label>
                  <input
                    type="checkbox"
                    checked={shared && !left.has(e.fullUrl)}
                    disabled={!shared}
                    onChange={(ev) => onLeave(e.fullUrl, !ev.target.checked)}
                  />
                  {describeResource(e.resource)} <span className="record-source">({e.resource.resourceType})</span>
                </label>
                {notes.get(e.fullUrl) && <span className="checkin-note">{notes.get(e.fullUrl)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.kind === 'form' && shared && (
        <CheckinForm
          questionnaire={p.questionnaire}
          form={form}
          onForm={onForm}
          idPrefix={`q-${item.id}`}
          describeSources={describeSources}
          skipped={skipped}
        />
      )}
    </section>
  )
}

export default function CheckinWallet() {
  const session = useSyncExternalStore(walletSession.subscribe, walletSession.get)
  const { patients, activeId, allData, logActivity, addPatient, renamePatient, addRecords, addClaims, sourceRecords } = useWorkspace()
  const [patientId, setPatientId] = useState(activeId)
  const [prepared, setPrepared] = useState(null)
  const [choices, setChoices] = useState({})
  const [answers, setAnswers] = useState({})
  // Records unticked within an item: { [itemId]: Set(fullUrl) }.
  const [leftOut, setLeftOut] = useState({})
  // Records M5 unticked because the patient removed them in a form, so
  // undoing the removal can tick them again: { [itemId]: Set(fullUrl) }.
  const [autoLeft, setAutoLeft] = useState({})
  // Prefilled answers left blank because the record's code wasn't a choice.
  const [skipped, setSkipped] = useState({})
  const [problem, setProblem] = useState(null)
  const [loading, setLoading] = useState(false)
  const context = session.status === 'request' ? session.context : null
  const resources = allData[patientId]?.fhirResources

  // Testers come with an empty M5: offer a synthetic patient to share from.
  async function loadTestPatient() {
    setLoading(true)
    setProblem(null)
    try {
      const bundle = await fetchFromGitHub(CHECKIN_TEST_PATIENT.url)
      const { records, claimsData } = bundleToRecords(bundle, { sourceType: 'open-synthetic-patients', documentName: 'maximus-decimus-meridius/bundle.json' })
      if (sourceRecords.length === 0) renamePatient(activeId, CHECKIN_TEST_PATIENT.name)
      else addPatient(CHECKIN_TEST_PATIENT.name)
      addRecords(records, [bundle])
      if (claimsData) addClaims(claimsData)
    } catch (err) {
      setProblem(err.message)
    } finally {
      setLoading(false)
    }
  }

  // A newly loaded patient becomes the one whose records are offered.
  useEffect(() => {
    setPatientId(activeId)
  }, [activeId])

  useEffect(() => {
    if (!context) return
    let live = true
    setPrepared(null)
    prepareItems({ request: context.request, unsupportedItems: context.unsupportedItems, entries: walletEntries(resources) }).then(async (p) => {
      // Forms that ask for it (SDC) are filled in from the records as
      // imported. The FHIRPath engine loads only when a form needs it.
      const records = Object.values(resources ?? {})
      const patientRecord = records.find((r) => r.resourceType === 'Patient')
      const prefill = {}
      const blank = {}
      const toFill = p.filter((x) => x.kind === 'form' && wantsPrefill(x.questionnaire))
      if (patientRecord && toFill.length) {
        try {
          const { populate } = await import('../lib/checkin/populate')
          for (const x of toFill) {
            const { response, origins, warnings } = populate(x.questionnaire, { patient: patientRecord, resources: records })
            prefill[x.item.id] = formFromPrefill(x.questionnaire, response, origins)
            blank[x.item.id] = warnings.filter((w) => w.includes("isn't one of the form's choices")).length
          }
        } catch {
          // Prefill is a convenience: the patient can still fill the form in.
        }
      }
      if (!live) return
      setPrepared(p)
      setChoices(Object.fromEntries(p.map((x) => [x.item.id, x.kind === 'form' || (x.kind === 'selection' && x.entries.length > 0)])))
      setAnswers(prefill)
      setSkipped(blank)
      setLeftOut({})
      setAutoLeft({})
    })
    return () => {
      live = false
    }
  }, [context, resources])

  if (session.status === 'starting' || session.status === 'waiting') {
    return <p className="import-message">Waiting for the check-in page to send its request…</p>
  }
  if (session.status === 'not-opened') {
    return (
      <section className="import-section">
        <h2>Check-in</h2>
        <p>
          This address is for check-in websites: one opens M5 here to ask for your records, and you choose what to share.
          Open M5 without <code>?checkin</code> to use it normally.
        </p>
      </section>
    )
  }
  if (session.status === 'invalid') return <p className="import-error">{session.error}</p>
  if (session.status === 'sent') return <p className="import-message">Sent. You can close this tab.</p>
  if (session.status === 'cancelled') return <p className="import-message">Nothing was shared. You can close this tab.</p>
  if (session.status === 'failed') return <p className="import-error">Something went wrong and the website was told. You can close this tab.</p>

  const { request, origin } = context
  const patient = patients.find((p) => p.id === patientId)
  const entries = walletEntries(resources)
  const patientRes = patientEntry(entries)

  function answerFor(itemId) {
    return asForm(answers[itemId])
  }

  // A form changed. If the patient removed an entry M5 filled in from a
  // record they're also being asked to share, untick that record too (and
  // tick it again if they undo); they can still change it by hand.
  function setForm(itemId, next) {
    const before = answerFor(itemId)
    setAnswers({ ...answers, [itemId]: next })
    const left = { ...leftOut }
    const auto = { ...autoLeft }
    let changed = false
    for (const [unit, status] of next.review) {
      const was = before.review.get(unit)
      if ((status === 'removed') === (was === 'removed')) continue
      for (const [target, urls] of Object.entries(recordsFor(prepared, next.sources.get(unit) ?? []))) {
        const l = new Set(left[target] ?? [])
        const a = new Set(auto[target] ?? [])
        for (const url of urls) {
          if (status === 'removed' && !l.has(url)) {
            l.add(url)
            a.add(url)
          } else if (status !== 'removed' && a.has(url)) {
            l.delete(url)
            a.delete(url)
          }
        }
        left[target] = l
        auto[target] = a
        changed = true
      }
    }
    if (changed) {
      setLeftOut(left)
      setAutoLeft(auto)
    }
  }

  // Records items that filled in a form: { itemId: Map(formTitle -> Set(section)) }.
  const feeds = {}
  const prefilledForms = new Set()
  for (const p of prepared ?? []) {
    if (p.kind !== 'form') continue
    const form = answerFor(p.item.id)
    if (form.review.size) prefilledForms.add(p.item.id)
    for (const [unit, refs] of form.sources) {
      for (const target of Object.keys(recordsFor(prepared, refs))) {
        const uses = (feeds[target] ??= new Map())
        if (!uses.has(p.item.title)) uses.set(p.item.title, new Set())
        uses.get(p.item.title).add(sectionTitle(p.questionnaire, unit))
      }
    }
  }

  // Notes beside shared records that the patient changed or removed in a form.
  const notes = new Map()
  for (const p of prepared ?? []) {
    if (p.kind !== 'form' || !choices[p.item.id]) continue
    const form = answerFor(p.item.id)
    for (const [unit, status] of form.review) {
      const removed = status === 'removed'
      if (!removed && !form.edited.has(unit)) continue
      for (const urls of Object.values(recordsFor(prepared, form.sources.get(unit) ?? []))) {
        for (const url of urls) {
          notes.set(
            url,
            removed
              ? `You removed this in "${p.item.title}", so it's unticked.`
              : `You corrected this in "${p.item.title}". The record itself is shared as it is unless you untick it.`,
          )
        }
      }
    }
  }

  function send() {
    for (const p of prepared) {
      if (p.kind !== 'form' || !choices[p.item.id]) continue
      const form = answerFor(p.item.id)
      if (responseItems(p.questionnaire, form).length === 0) {
        setProblem(`Answer the questions in "${p.item.title}", or untick it to leave it out.`)
        return
      }
      const unchecked = pendingReview(form).length
      if (unchecked) {
        setProblem(`Check what M5 filled in from your records in "${p.item.title}" (${unchecked} left), or untick it to leave it out.`)
        return
      }
      const missing = missingRequired(p.questionnaire, form)
      if (missing.length) {
        setProblem(`Answer "${missing[0]}" in ${p.item.title}, or untick it to leave it out.`)
        return
      }
    }
    const allAnswers = Object.fromEntries(prepared.map((p) => [p.item.id, answerFor(p.item.id)]))
    const response = buildResponse({ request, prepared, choices, answers: allAnswers, patientRef: patientRes?.fullUrl, leftOut })
    const sharedTitles = prepared.filter((p) => ['fulfilled', 'partial'].includes(response.requestStatus.find((s) => s.item === p.item.id)?.status)).map((p) => p.item.title)
    logActivity({
      action: 'Shared',
      patientId,
      detail: `SMART Health Check-in with ${origin}: ${sharedTitles.join(', ') || 'nothing'}`,
      purpose: request.purpose ? `Check-in: ${request.purpose}` : 'Check-in requested by the website',
    })
    session.reply({ response })
  }

  function shareNothing() {
    logActivity({ action: 'Declined', patientId, detail: `SMART Health Check-in request from ${origin}`, purpose: 'Declined by you' })
    session.reply({ response: declineAll(request) })
  }

  return (
    <div className="checkin-wallet">
      <section className="checkin-who">
        <p>A website is asking for your health information:</p>
        <p className="checkin-origin">{origin}</p>
        {request.purpose && <p>It says the reason is: {request.purpose}</p>}
        <p className="section-help">
          M5 only knows the website&apos;s address, not who runs it. Share only if you expect this request. What you share goes
          to that address only, encrypted for it.
        </p>
      </section>

      {patients.length > 1 && (
        <label className="file-label">
          Whose information
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {entries.length === 0 && (
        <div className="import-section">
          <p>
            M5 has no FHIR records saved for {patient?.name}. M5 keeps records as FHIR from this version on, so import them
            again (from a health system, a FHIR file or open-synthetic-patients) to share them here.
          </p>
          <p>Testing? Load a synthetic test patient with US Core records and an insurance card.</p>
          <button type="button" onClick={loadTestPatient} disabled={loading}>
            {loading ? 'Loading…' : `Load the synthetic test patient (${CHECKIN_TEST_PATIENT.name})`}
          </button>
        </div>
      )}

      {!prepared ? (
        <p className="import-message">Looking through the records…</p>
      ) : (
        displayOrder(prepared, prefilledForms).map((p) => (
          <ItemCard
            key={p.item.id}
            p={p}
            shared={!!choices[p.item.id]}
            onShare={(v) => setChoices({ ...choices, [p.item.id]: v })}
            form={answerFor(p.item.id)}
            onForm={(next) => setForm(p.item.id, next)}
            skipped={skipped[p.item.id] ?? 0}
            notes={notes}
            feeds={feeds[p.item.id] ? feedsNote(feeds[p.item.id]) : null}
            left={leftOut[p.item.id]}
            onLeave={(fullUrl, leave) => {
              const next = new Set(leftOut[p.item.id] ?? [])
              if (leave) next.add(fullUrl)
              else next.delete(fullUrl)
              setLeftOut({ ...leftOut, [p.item.id]: next })
              // Ticked or unticked by hand: no longer M5's doing.
              const auto = new Set(autoLeft[p.item.id] ?? [])
              auto.delete(fullUrl)
              setAutoLeft({ ...autoLeft, [p.item.id]: auto })
            }}
          />
        ))
      )}

      {problem && <p className="import-error">{problem}</p>}
      <div className="button-row">
        <button type="button" onClick={send} disabled={!prepared}>
          Share what&apos;s ticked
        </button>
        <button type="button" onClick={shareNothing} disabled={!prepared}>
          Share nothing
        </button>
        <button type="button" onClick={() => session.reply({ declined: true })}>
          Cancel
        </button>
      </div>
    </div>
  )
}
