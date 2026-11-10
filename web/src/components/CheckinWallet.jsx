import { useEffect, useState, useSyncExternalStore } from 'react'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import { useWorkspace } from '../state/WorkspaceContext'
import { walletSession } from '../lib/checkin/session'
import { buildResponse, declineAll, patientEntry, prepareItems, walletEntries } from '../lib/checkin/respond'
import { missingRequired } from '../lib/checkin/forms'
import { asForm, confirmAll, formFromPrefill, isEnabledAt, pendingReview, responseItems, wantsPrefill } from '../lib/checkin/formState'
import CheckinForm from './CheckinForm'
import { Progress, RecordsStep, ReviewScreen, ShareSwitch, StartScreen } from './CheckinSteps'
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
      return `These also filled in the ${names} ${list.length > 1 ? 'parts' : 'part'} of your "${title}" form.`
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
  // Which screen: 0 is the start, then one per step, then the last look.
  const [step, setStep] = useState(0)
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
      setStep(0)
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
              ? `You removed this in your "${p.item.title}" form, so it's unticked.`
              : `You changed this in your "${p.item.title}" form. If you share this record, it goes as it is.`,
          )
        }
      }
    }
  }

  // What still needs the patient before a shared form can go, in plain words.
  function issueFor(p) {
    if (p.kind !== 'form' || !choices[p.item.id]) return null
    const form = answerFor(p.item.id)
    if (responseItems(p.questionnaire, form).length === 0) return 'No answers yet.'
    const unchecked = pendingReview(form).length
    if (unchecked) return `${unchecked} ${unchecked === 1 ? 'part' : 'parts'} still to check.`
    const missing = missingRequired(p.questionnaire, form)
    if (missing.length) return `Needs an answer: "${missing[0]}".`
    return null
  }

  function send() {
    const blocked = prepared.find((p) => issueFor(p))
    if (blocked) {
      setProblem(`"${blocked.item.title}": ${issueFor(blocked)}`)
      return
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

  const ordered = prepared ? displayOrder(prepared, prefilledForms) : []

  // The steps: a long form filled in from records goes one part (top-level
  // section) at a time; everything else is one step.
  const steps = [{ kind: 'start' }]
  for (const p of ordered) {
    const form = answerFor(p.item.id)
    if (p.kind === 'form' && choices[p.item.id] && prefilledForms.has(p.item.id)) {
      const parts = p.questionnaire.item.filter((i) => i.type !== 'display' && isEnabledAt(i, form, ''))
      parts.forEach((section, n) => steps.push({ kind: 'section', p, section, n: n + 1, of: parts.length }))
    } else {
      steps.push({ kind: 'item', p })
    }
  }
  steps.push({ kind: 'review' })
  const at = Math.min(step, steps.length - 1)
  const current = steps[at]

  function go(n) {
    setProblem(null)
    setStep(Math.max(0, Math.min(n, steps.length - 1)))
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 })
  }
  const jump = (id) => go(id === 'review' ? steps.length - 1 : steps.findIndex((s) => s.p?.item.id === id))

  // The review units of one form section: its own and its entries'.
  const unitsIn = (form, linkId) => [...form.review.keys()].filter((u) => u === `top:${linkId}` || u.startsWith(`${linkId}#`))

  function summary(p) {
    const shared = !!choices[p.item.id]
    const base = { id: p.item.id, title: p.item.title, shared: shared && p.kind !== 'unsupported' }
    if (p.kind === 'unsupported') return { ...base, detail: "M5 can't send this. The website will be told." }
    if (!shared) return { ...base, detail: "You chose not to share this." }
    if (p.kind === 'selection') {
      const n = p.records.length
      if (n === 0) return { ...base, shared: false, detail: 'Nothing matched. The website will be told.' }
      const kept = p.records.filter((e) => !(leftOut[p.item.id] ?? new Set()).has(e.fullUrl)).length
      return { ...base, detail: `${kept} of ${n} ${n === 1 ? 'record' : 'records'}` }
    }
    const issue = issueFor(p)
    if (issue) return { ...base, issue }
    const form = answerFor(p.item.id)
    const removed = [...form.review.values()].filter((v) => v === 'removed').length
    const changed = form.edited.size
    const bits = [prefilledForms.has(p.item.id) ? 'Checked' : 'Answered']
    if (changed) bits.push(`you changed ${changed}`)
    if (removed) bits.push(`you removed ${removed}`)
    return { ...base, detail: bits.join(', ') }
  }

  // A step shows as done once the patient is past it and nothing in it needs them.
  const currentId = current.kind === 'review' ? 'review' : current.p?.item.id
  const reached = ordered.findIndex((p) => p.item.id === currentId)
  const progressItems = [
    ...ordered.map((p, n) => ({ id: p.item.id, title: p.item.title, done: (currentId === 'review' || n < reached) && !issueFor(p) })),
    { id: 'review', title: 'Send' },
  ]

  const onLeave = (itemId) => (fullUrl, leave) => {
    const next = new Set(leftOut[itemId] ?? [])
    if (leave) next.add(fullUrl)
    else next.delete(fullUrl)
    setLeftOut({ ...leftOut, [itemId]: next })
    // Ticked or unticked by hand: no longer M5's doing.
    const auto = new Set(autoLeft[itemId] ?? [])
    auto.delete(fullUrl)
    setAutoLeft({ ...autoLeft, [itemId]: auto })
  }

  const whose = (
    <>
      {patients.length > 1 && (
        <label className="ck-field">
          <span>Whose records</span>
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
        <div className="ck-empty">
          <p>M5 has no health records saved for {patient?.name} yet. Add them in M5 first, then come back.</p>
          <p>Just testing? Use a made-up patient instead.</p>
          <button type="button" className="ck-secondary" onClick={loadTestPatient} disabled={loading}>
            {loading ? 'Loading…' : `Load the synthetic test patient (${CHECKIN_TEST_PATIENT.name})`}
          </button>
        </div>
      )}
    </>
  )

  let body
  if (!prepared) {
    body = <p className="ck-lead">Looking through your records…</p>
  } else if (current.kind === 'start') {
    body = (
      <StartScreen
        origin={origin}
        purpose={request.purpose}
        ordered={ordered}
        prefilled={prefilledForms}
        feeds={feeds}
        onStart={() => go(1)}
        onShareNothing={shareNothing}
        onNotNow={() => session.reply({ declined: true })}
      >
        {whose}
      </StartScreen>
    )
  } else if (current.kind === 'review') {
    body = (
      <>
        <Progress items={progressItems} current="review" onJump={jump} />
        <ReviewScreen origin={origin} rows={ordered.map(summary)} problem={problem} onEdit={jump} onSend={send} onShareNothing={shareNothing} />
        <div className="ck-nav">
          <button type="button" className="ck-back" onClick={() => go(at - 1)}>
            Back
          </button>
        </div>
      </>
    )
  } else {
    const { p } = current
    const id = p.item.id
    const shared = !!choices[id]
    const form = answerFor(id)
    let heading = p.item.title
    let lead = null
    let content = null
    let primary = { label: 'Next', run: () => go(at + 1) }
    if (current.kind === 'section') {
      const units = unitsIn(form, current.section.linkId)
      const pending = units.filter((u) => form.review.get(u) === 'pending')
      const from = describeSources([...new Set(units.flatMap((u) => form.sources.get(u) ?? []))])
      heading = current.section.text ?? p.item.title
      lead = units.length
        ? `We filled this in from your ${from || 'records'}. Is it right? Fix anything that's wrong.`
        : current.section.type === 'group'
          ? 'Please fill this in.'
          : null
      if (pending.length) {
        primary = {
          label: 'Looks right, next',
          run: () => {
            setForm(id, confirmAll(form, pending))
            go(at + 1)
          },
        }
      }
      content = (
        <CheckinForm
          questionnaire={p.questionnaire}
          form={form}
          onForm={(next) => setForm(id, next)}
          idPrefix={`q-${id}`}
          describeSources={describeSources}
          section={current.section.linkId}
        />
      )
    } else if (p.kind === 'form') {
      lead = shared ? 'Answer the questions below.' : null
      content = shared && (
        <CheckinForm questionnaire={p.questionnaire} form={form} onForm={(next) => setForm(id, next)} idPrefix={`q-${id}`} describeSources={describeSources} />
      )
    } else if (p.kind === 'selection') {
      content = <RecordsStep p={p} shared={shared} left={leftOut[id]} notes={notes} feeds={feeds[id] ? feedsNote(feeds[id]) : null} onLeave={onLeave(id)} />
    } else {
      lead = `M5 can't answer this one: ${p.reason}. It will tell the website.`
    }
    if (steps[at + 1]?.kind === 'review') primary = { ...primary, label: primary.label === 'Next' ? 'Next: last look' : 'Looks right, last look' }
    const shareable = p.kind === 'form' || (p.kind === 'selection' && p.records.length > 0)
    const firstOfItem = current.kind !== 'section' || current.n === 1
    body = (
      <>
        <Progress items={progressItems} current={id} onJump={jump} />
        <section className="ck-screen">
          {current.kind === 'section' && (
            <p className="ck-part">
              {p.item.title}: part {current.n} of {current.of}
            </p>
          )}
          <h2 className="ck-title">{heading}</h2>
          {p.item.required && firstOfItem && <p className="ck-hint">The website says it needs this.</p>}
          {shareable && firstOfItem && <ShareSwitch title={p.item.title} shared={shared} onChange={(v) => setChoices({ ...choices, [id]: v })} />}
          {lead && <p className="ck-lead">{lead}</p>}
          {current.kind === 'section' && current.n === 1 && (skipped[id] ?? 0) > 0 && (
            <p className="ck-hint">
              {skipped[id]} {skipped[id] === 1 ? 'answer' : 'answers'} from your records didn&apos;t fit this form, so {skipped[id] === 1 ? 'it was' : 'they were'} left blank.
            </p>
          )}
          {content}
        </section>
        <div className="ck-nav">
          <button type="button" className="ck-back" onClick={() => go(at - 1)}>
            Back
          </button>
          <button type="button" className="ck-primary" onClick={primary.run}>
            {primary.label}
          </button>
        </div>
      </>
    )
  }

  return (
    <div className="checkin-wallet ck">
      {body}
    </div>
  )
}
