import {
  addEntry,
  confirmAll,
  instancePrefix,
  isEnabledAt,
  pendingReview,
  removeEntry,
  setAnswer,
  setReview,
} from '../lib/checkin/formState'

// One check-in form (a FHIR Questionnaire). When M5 has filled it in from the
// patient's records, each section and each entry (an allergy, a medication,
// an insurance plan) says where it came from, and the patient marks it right,
// fixes it, or removes it before it can be sent.

const answerKey = (a) => JSON.stringify(a)
const domId = (s) => s.replace(/[^A-Za-z0-9_-]/g, '_')

function optionValue(o) {
  if (o.valueCoding) return { valueCoding: o.valueCoding }
  if (o.valueString !== undefined) return { valueString: o.valueString }
  if (o.valueInteger !== undefined) return { valueInteger: o.valueInteger }
  if (o.valueDate !== undefined) return { valueDate: o.valueDate }
  return null
}

function answerLabel(a) {
  if (!a) return ''
  if (a.valueCoding) return a.valueCoding.display ?? a.valueCoding.code ?? ''
  if (a.valueBoolean !== undefined) return a.valueBoolean ? 'Yes' : 'No'
  const v = Object.values(a)[0]
  return v === undefined || v === null ? '' : String(v)
}

function Legend({ label, required }) {
  return (
    <legend>
      {label}
      {required && <span className="q-req"> (needed)</span>}
    </legend>
  )
}

function ChoiceQuestion({ item, given, set, id, label }) {
  const options = (item.answerOption ?? []).map((o) => ({ value: optionValue(o), label: answerLabel(optionValue(o)) })).filter((o) => o.value)
  const listed = new Set(options.map((o) => answerKey(o.value)))
  const open = item.type === 'open-choice'
  // A coded answer from the patient's record that isn't on the list (open-choice) still shows, ticked.
  const extra = given.filter((g) => g.valueCoding && !listed.has(answerKey(g)))
  const typed = given.find((g) => g.valueString !== undefined && !listed.has(answerKey(g)))
  const chosen = new Set(given.map(answerKey))
  const toggle = (value, on) => {
    if (!item.repeats) set(on ? [value] : [])
    else set(on ? [...given, value] : given.filter((g) => answerKey(g) !== answerKey(value)))
  }

  if (open && options.length === 0) {
    // Nothing to pick from: the record's coded answer, or what the patient types.
    const current = given[0]
    return (
      <label className="file-label">
        <span>
          {label}
          {item.required && <span className="q-req"> (needed)</span>}
        </span>
        <input id={id} type="text" value={answerLabel(current)} onChange={(e) => set(e.target.value === '' ? [] : [{ valueString: e.target.value }])} />
        {current?.valueCoding && <span className="q-coded">As coded in your record</span>}
      </label>
    )
  }

  // A long single-answer list (like US states) is a dropdown.
  if (!open && !item.repeats && options.length > 8) {
    const index = options.findIndex((o) => chosen.has(answerKey(o.value)))
    return (
      <label className="file-label">
        <span>
          {label}
          {item.required && <span className="q-req"> (needed)</span>}
        </span>
        <select id={id} value={index < 0 ? '' : String(index)} onChange={(e) => set(e.target.value === '' ? [] : [options[Number(e.target.value)].value])}>
          <option value="">Choose…</option>
          {options.map((o, i) => (
            <option key={i} value={String(i)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <fieldset className={options.length > 8 ? 'q-choice q-choice-many' : 'q-choice'}>
      <Legend label={label} required={item.required} />
      {[...options, ...extra.map((g) => ({ value: g, label: answerLabel(g) }))].map((o, i) => (
        <label key={i}>
          <input
            type={item.repeats ? 'checkbox' : 'radio'}
            name={id}
            checked={chosen.has(answerKey(o.value))}
            onChange={(e) => toggle(o.value, e.target.checked)}
          />
          {o.label}
        </label>
      ))}
      {open && (
        <label className="q-other">
          Other
          <input
            type="text"
            value={typed?.valueString ?? ''}
            onChange={(e) => {
              const rest = given.filter((g) => g !== typed && (item.repeats || g.valueString === undefined))
              const keep = item.repeats ? rest : []
              set(e.target.value === '' ? keep : [...keep, { valueString: e.target.value }])
            }}
          />
        </label>
      )}
    </fieldset>
  )
}

function Question({ item, prefix, ctx }) {
  const key = prefix + item.linkId
  const id = `${ctx.idPrefix}-${domId(key)}`
  const given = ctx.form.answers.get(key) ?? []
  const label = `${item.prefix ? `${item.prefix} ` : ''}${item.text ?? ''}`
  const set = (list) => ctx.onForm(setAnswer(ctx.form, ctx.questionnaire, key, list))
  if (item.type === 'display') return <p className="q-display">{item.text}</p>
  if (item.type === 'choice' || item.type === 'open-choice') return <ChoiceQuestion item={item} given={given} set={set} id={id} label={label} />
  if (item.type === 'boolean') {
    const v = given[0]?.valueBoolean
    return (
      <fieldset className="q-choice">
        <Legend label={label} required={item.required} />
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
    dateTime: ['date', (v) => ({ valueDateTime: v })],
  }
  const kind = kinds[item.type]
  if (!kind) return <p className="section-help">{label} (M5 can&apos;t answer this kind of question; it will be left blank.)</p>
  const current = given[0] ? String(Object.values(given[0])[0]).slice(0, item.type === 'dateTime' ? 10 : undefined) : ''
  return (
    <label className="file-label">
      <span>
        {label}
        {item.required && <span className="q-req"> (needed)</span>}
      </span>
      <input id={id} type={kind[0]} value={current} onChange={(e) => set(e.target.value === '' ? [] : [kind[1](e.target.value)])} />
    </label>
  )
}

// Where M5 got a section or entry, and the patient's check of it.
function ReviewBar({ unit, ctx, onRemove, what }) {
  const status = ctx.form.review.get(unit)
  if (!status) return null
  const edited = ctx.form.edited.has(unit)
  const from = ctx.describeSources(ctx.form.sources.get(unit) ?? [])
  return (
    <div className={`q-review q-review-${status}`}>
      <span className="q-from">
        {from ? `From your ${from}` : 'Filled in from your records'}
        {edited && ' · you changed this'}
      </span>
      {status === 'confirmed' ? (
        <span className="q-checked">✓ Checked</span>
      ) : (
        <button type="button" onClick={() => ctx.onForm(setReview(ctx.form, unit, 'confirmed'))} aria-label={`${what} is right`}>
          This is right
        </button>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${what}`}>
          Remove
        </button>
      )}
    </div>
  )
}

function firstAnswer(items = [], prefix, form) {
  for (const i of items) {
    if (i.type === 'group') {
      if (i.repeats) continue
      const inner = firstAnswer(i.item, prefix, form)
      if (inner) return inner
    } else {
      const a = form.answers.get(prefix + i.linkId)?.[0]
      if (a) return answerLabel(a)
    }
  }
  return ''
}

function RepeatingGroup({ item, prefix, ctx }) {
  const groupKey = prefix + item.linkId
  const ids = ctx.form.groups.get(groupKey) ?? []
  const entries = ids.map((id) => ({ id, p: instancePrefix(prefix, item.linkId, id) }))
  const pending = entries.map((e) => e.p).filter((p) => ctx.form.review.get(p) === 'pending')
  return (
    <fieldset className="q-group q-repeating">
      <legend>{item.text}</legend>
      {pending.length > 1 && (
        <button type="button" className="q-all" onClick={() => ctx.onForm(confirmAll(ctx.form, pending))}>
          All {pending.length} below are right
        </button>
      )}
      {entries.length === 0 && <p className="section-help">None listed.</p>}
      {entries.map(({ id, p }, n) => {
        const summary = firstAnswer(item.item, p, ctx.form) || `${item.text} ${n + 1}`
        const what = `${item.text}: ${summary}`
        if (ctx.form.review.get(p) === 'removed') {
          return (
            <div key={id} className="q-entry q-entry-removed">
              <span>
                Removed: <s>{summary}</s>
              </span>
              <button type="button" onClick={() => ctx.onForm(setReview(ctx.form, p, 'pending'))} aria-label={`Undo removing ${what}`}>
                Undo
              </button>
            </div>
          )
        }
        const remove = () => ctx.onForm(removeEntry(ctx.form, groupKey, id))
        return (
          <div key={id} className="q-entry">
            <Items items={item.item} prefix={p} ctx={ctx} />
            {ctx.form.review.has(p) ? (
              <ReviewBar unit={p} ctx={ctx} onRemove={remove} what={what} />
            ) : (
              <div className="q-review">
                <button type="button" onClick={remove} aria-label={`Remove ${what}`}>
                  Remove
                </button>
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="q-add" onClick={() => ctx.onForm(addEntry(ctx.form, groupKey))}>
        Add to {item.text}
      </button>
    </fieldset>
  )
}

function Item({ item, prefix, ctx, top }) {
  if (item.type === 'group' && item.repeats) return <RepeatingGroup item={item} prefix={prefix} ctx={ctx} />
  const unit = top ? `top:${item.linkId}` : null
  if (item.type === 'group') {
    return (
      <fieldset className="q-group">
        {item.text && <legend>{item.text}</legend>}
        <Items items={item.item} prefix={prefix} ctx={ctx} />
        {unit && <ReviewBar unit={unit} ctx={ctx} what={item.text ?? item.linkId} />}
      </fieldset>
    )
  }
  return (
    <>
      <Question item={item} prefix={prefix} ctx={ctx} />
      {unit && <ReviewBar unit={unit} ctx={ctx} what={item.text ?? item.linkId} />}
    </>
  )
}

function Items({ items = [], prefix, ctx, top = false }) {
  return items
    .filter((i) => isEnabledAt(i, ctx.form, prefix))
    .map((i) => <Item key={prefix + i.linkId} item={i} prefix={prefix} ctx={ctx} top={top} />)
}

export default function CheckinForm({ questionnaire, form, onForm, idPrefix, describeSources, skipped = 0 }) {
  const ctx = { questionnaire, form, onForm, idPrefix, describeSources }
  const left = pendingReview(form).length
  const prefilled = form.review.size > 0
  return (
    <div className="checkin-form">
      {prefilled && (
        <p className={left ? 'q-intro' : 'q-intro q-intro-done'}>
          {left
            ? `M5 filled in what it could from your records. Check each part, fix anything that's wrong, and remove anything that's no longer true. ${left} left to check.`
            : 'Everything M5 filled in has been checked.'}
          {skipped > 0 && ` ${skipped} ${skipped === 1 ? 'answer' : 'answers'} from your records didn't match this form's choices and were left blank.`}
        </p>
      )}
      <Items items={questionnaire.item} prefix="" ctx={ctx} top />
    </div>
  )
}
