import { useEffect, useState, useSyncExternalStore } from 'react'
import { useWorkspace } from '../state/WorkspaceContext'
import { walletSession } from '../lib/checkin/session'
import { buildResponse, declineAll, describeResource, patientEntry, prepareItems, walletEntries } from '../lib/checkin/respond'
import { isEnabled, missingRequired } from '../lib/checkin/forms'

// M5 as a SMART Health Check-in web wallet: a check-in page opens M5 with
// ?checkin and asks for records and forms; the patient picks what to share,
// item by item, and M5 sends it back encrypted to that page only.

function answerKey(a) {
  return JSON.stringify(a)
}

function optionValue(o) {
  if (o.valueCoding) return { valueCoding: o.valueCoding }
  if (o.valueString !== undefined) return { valueString: o.valueString }
  if (o.valueInteger !== undefined) return { valueInteger: o.valueInteger }
  if (o.valueDate !== undefined) return { valueDate: o.valueDate }
  return null
}

function optionLabel(o) {
  return o.valueCoding?.display ?? o.valueCoding?.code ?? o.valueString ?? String(o.valueInteger ?? o.valueDate ?? '')
}

function Question({ item, answers, onChange, idPrefix }) {
  const id = `${idPrefix}-${item.linkId}`
  const given = answers.get(item.linkId) ?? []
  const label = `${item.prefix ? `${item.prefix} ` : ''}${item.text ?? ''}`
  const set = (list) => onChange(item.linkId, list)
  if (item.type === 'display') return <p className="q-display">{item.text}</p>
  if (item.type === 'group') {
    return (
      <fieldset className="q-group">
        {item.text && <legend>{item.text}</legend>}
        <Questions items={item.item} answers={answers} onChange={onChange} idPrefix={idPrefix} />
      </fieldset>
    )
  }
  if (item.type === 'choice' || item.type === 'open-choice') {
    const options = (item.answerOption ?? []).map((o) => ({ value: optionValue(o), label: optionLabel(o) })).filter((o) => o.value)
    const chosen = new Set(given.map(answerKey))
    return (
      <fieldset className="q-choice">
        <legend>
          {label}
          {item.required && <span className="q-req"> (needed)</span>}
        </legend>
        {options.map((o, i) => (
          <label key={i}>
            <input
              type={item.repeats ? 'checkbox' : 'radio'}
              name={id}
              checked={chosen.has(answerKey(o.value))}
              onChange={(e) => {
                if (!item.repeats) set([o.value])
                else set(e.target.checked ? [...given, o.value] : given.filter((g) => answerKey(g) !== answerKey(o.value)))
              }}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    )
  }
  if (item.type === 'boolean') {
    const v = given[0]?.valueBoolean
    return (
      <fieldset className="q-choice">
        <legend>{label}</legend>
        {[
          [true, 'Yes'],
          [false, 'No'],
        ].map(([val, text]) => (
          <label key={text}>
            <input type="radio" name={id} checked={v === val} onChange={() => set([{ valueBoolean: val }])} />
            {text}
          </label>
        ))}
      </fieldset>
    )
  }
  const kinds = {
    string: ['text', (v) => ({ valueString: v })],
    text: ['text', (v) => ({ valueString: v })],
    integer: ['number', (v) => ({ valueInteger: Number.parseInt(v, 10) })],
    decimal: ['number', (v) => ({ valueDecimal: Number(v) })],
    date: ['date', (v) => ({ valueDate: v })],
  }
  const kind = kinds[item.type]
  if (!kind) return <p className="section-help">{label} (M5 can&apos;t answer this kind of question; it will be left blank.)</p>
  const current = given[0] ? Object.values(given[0])[0] : ''
  return (
    <label className="file-label">
      {label}
      {item.required && <span className="q-req"> (needed)</span>}
      <input id={id} type={kind[0]} value={current} onChange={(e) => set(e.target.value === '' ? [] : [kind[1](e.target.value)])} />
    </label>
  )
}

function Questions({ items = [], answers, onChange, idPrefix }) {
  return items
    .filter((i) => isEnabled(i, answers))
    .map((i) => <Question key={i.linkId} item={i} answers={answers} onChange={onChange} idPrefix={idPrefix} />)
}

function ItemCard({ p, shared, onShare, answers, onAnswer }) {
  const { item } = p
  const matches = p.kind === 'selection' ? p.entries : []
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
      {p.kind === 'selection' && matches.length > 0 && (
        <details>
          <summary>
            {matches.length} {matches.length === 1 ? 'record' : 'records'}
          </summary>
          <ul className="checkin-records">
            {matches.map((e) => (
              <li key={e.fullUrl}>
                {describeResource(e.resource)} <span className="record-source">({e.resource.resourceType})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.kind === 'form' && shared && (
        <div className="checkin-form">
          <Questions items={p.questionnaire.item} answers={answers} onChange={onAnswer} idPrefix={`q-${item.id}`} />
        </div>
      )}
    </section>
  )
}

export default function CheckinWallet() {
  const session = useSyncExternalStore(walletSession.subscribe, walletSession.get)
  const { patients, activeId, allData, logActivity } = useWorkspace()
  const [patientId, setPatientId] = useState(activeId)
  const [prepared, setPrepared] = useState(null)
  const [choices, setChoices] = useState({})
  const [answers, setAnswers] = useState({})
  const [problem, setProblem] = useState(null)
  const context = session.status === 'request' ? session.context : null
  const resources = allData[patientId]?.fhirResources

  useEffect(() => {
    if (!context) return
    let live = true
    setPrepared(null)
    prepareItems({ request: context.request, unsupportedItems: context.unsupportedItems, entries: walletEntries(resources) }).then((p) => {
      if (!live) return
      setPrepared(p)
      setChoices(Object.fromEntries(p.map((x) => [x.item.id, x.kind === 'form' || (x.kind === 'selection' && x.entries.length > 0)])))
      setAnswers({})
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
    return answers[itemId] ?? new Map()
  }

  function setAnswer(itemId, linkId, list) {
    const next = new Map(answerFor(itemId))
    if (list.length) next.set(linkId, list)
    else next.delete(linkId)
    setAnswers({ ...answers, [itemId]: next })
  }

  function send() {
    for (const p of prepared) {
      if (p.kind !== 'form' || !choices[p.item.id]) continue
      const missing = missingRequired(p.questionnaire, answerFor(p.item.id))
      if (missing.length) {
        setProblem(`Answer "${missing[0]}" in ${p.item.title}, or untick it to leave it out.`)
        return
      }
    }
    const allAnswers = Object.fromEntries(prepared.map((p) => [p.item.id, answerFor(p.item.id)]))
    const response = buildResponse({ request, prepared, choices, answers: allAnswers, patientRef: patientRes?.fullUrl })
    const sharedTitles = prepared.filter((p) => response.requestStatus.find((s) => s.item === p.item.id)?.status === 'fulfilled').map((p) => p.item.title)
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
        <p className="import-error">
          M5 has no FHIR records saved for {patient?.name}. M5 keeps records as FHIR from this version on: import them again
          (from a health system, a FHIR file or open-synthetic-patients) to share them here.
        </p>
      )}

      {!prepared ? (
        <p className="import-message">Looking through the records…</p>
      ) : (
        prepared.map((p) => (
          <ItemCard
            key={p.item.id}
            p={p}
            shared={!!choices[p.item.id]}
            onShare={(v) => setChoices({ ...choices, [p.item.id]: v })}
            answers={answerFor(p.item.id)}
            onAnswer={(linkId, list) => setAnswer(p.item.id, linkId, list)}
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
