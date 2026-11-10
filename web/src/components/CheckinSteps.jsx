import { describeResource } from '../lib/checkin/respond'

// The screens of the step-by-step check-in: what's asked, one step at a time,
// then a last look before sending. Words are kept short and plain so anyone
// can follow them.

function hostOf(origin) {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

// "Step 2 of 4" and a bar, plus the step names to jump between.
export function Progress({ items, current, onJump }) {
  const at = items.findIndex((i) => i.id === current)
  const total = items.length
  return (
    <nav className="ck-progress" aria-label="Check-in steps">
      <p className="ck-progress-count">
        Step {at + 1} of {total}
      </p>
      <div className="ck-bar" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at + 1} aria-label="Progress">
        <span style={{ width: `${((at + 1) / total) * 100}%` }} />
      </div>
      <ol className="ck-steps">
        {items.map((i, n) => (
          <li key={i.id}>
            <button
              type="button"
              className={`ck-step-link${n === at ? ' is-current' : ''}${i.done ? ' is-done' : ''}`}
              aria-current={n === at ? 'step' : undefined}
              onClick={() => onJump(i.id)}
            >
              {i.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

// What M5 will do with each item, in a line.
function plan(p, { prefilled, feeds }) {
  if (p.kind === 'unsupported') return "M5 can't answer this one. It will tell the website."
  if (p.kind === 'form') return prefilled ? 'M5 fills in most of it from your records. You check each part.' : 'You answer these questions yourself.'
  const n = p.records.length
  if (n === 0) return 'Nothing in your records matches. M5 will tell the website.'
  const base = `You pick which of your ${n} ${n === 1 ? 'record' : 'records'} to share.`
  return feeds ? `${base} These also fill in your form.` : base
}

export function StartScreen({ origin, purpose, ordered, prefilled, feeds, onStart, onShareNothing, onNotNow, children }) {
  return (
    <section className="ck-screen ck-start">
      <h2 className="ck-title">A website wants you to check in</h2>
      <p className="ck-origin">{hostOf(origin)}</p>
      {purpose && <p className="ck-purpose">It says: &ldquo;{purpose}&rdquo;</p>}
      <p className="ck-caution">M5 can&apos;t tell who runs this website. Only go on if you were expecting it.</p>
      {children}
      <h3 className="ck-subtitle">It asks for {ordered.length === 1 ? '1 thing' : `${ordered.length} things`}</h3>
      <ol className="ck-plan">
        {ordered.map((p) => (
          <li key={p.item.id}>
            <strong>{p.item.title}</strong>
            <span>{plan(p, { prefilled: prefilled.has(p.item.id), feeds: !!feeds[p.item.id] })}</span>
          </li>
        ))}
      </ol>
      <p className="ck-promise">Nothing is sent until you say so at the end.</p>
      <div className="ck-actions">
        <button type="button" className="ck-primary" onClick={onStart}>
          Start
        </button>
      </div>
      <div className="ck-quiet-actions">
        <button type="button" className="ck-link" onClick={onShareNothing}>
          Share nothing
        </button>
        <button type="button" className="ck-link" onClick={onNotNow}>
          Not now
        </button>
      </div>
    </section>
  )
}

// The switch at the top of each step: share this item or not.
export function ShareSwitch({ title, shared, disabled, onChange }) {
  return (
    <label className={`ck-switch${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={shared && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={`Share ${title}`} />
      <span className="ck-switch-track" aria-hidden="true" />
      <span>{shared && !disabled ? 'Sharing this' : 'Not sharing this'}</span>
    </label>
  )
}

export function RecordsStep({ p, shared, left = new Set(), notes, feeds, onLeave }) {
  const records = p.records
  if (records.length === 0) return <p className="ck-lead">Nothing in your records matches this. M5 will tell the website none is available.</p>
  return (
    <>
      <p className="ck-lead">{records.length === 1 ? 'This record matches. Untick it to keep it private.' : 'Tick the records you want to share.'}</p>
      {feeds && <p className="ck-hint">{feeds}</p>}
      <ul className="ck-records">
        {records.map((e) => (
          <li key={e.fullUrl}>
            <label className={`ck-record${!shared || left.has(e.fullUrl) ? ' is-off' : ''}`}>
              <input type="checkbox" checked={shared && !left.has(e.fullUrl)} disabled={!shared} onChange={(ev) => onLeave(e.fullUrl, !ev.target.checked)} />
              <span>{describeResource(e.resource)}</span>
            </label>
            {notes.get(e.fullUrl) && <p className="ck-note">{notes.get(e.fullUrl)}</p>}
          </li>
        ))}
      </ul>
    </>
  )
}

export function ReviewScreen({ origin, rows, problem, onEdit, onSend, onShareNothing }) {
  const blocked = rows.some((r) => r.issue)
  return (
    <section className="ck-screen">
      <h2 className="ck-title">Ready to send?</h2>
      <p className="ck-lead">Here is what goes to {hostOf(origin)}.</p>
      <ul className="ck-summary">
        {rows.map((r) => (
          <li key={r.id} className={r.issue ? 'is-issue' : r.shared ? 'is-ok' : 'is-off'}>
            <span className="ck-mark" aria-hidden="true">
              {r.issue ? '!' : r.shared ? '✓' : '–'}
            </span>
            <span className="ck-summary-text">
              <strong>{r.title}</strong>
              <span>{r.issue ?? r.detail}</span>
            </span>
            <button type="button" className="ck-link" onClick={() => onEdit(r.id)} aria-label={`${r.issue ? 'Fix' : 'Change'} ${r.title}`}>
              {r.issue ? 'Fix' : 'Change'}
            </button>
          </li>
        ))}
      </ul>
      {blocked && <p className="ck-warn">Fix the parts marked ! first.</p>}
      {problem && <p className="ck-warn">{problem}</p>}
      <p className="ck-hint">It&apos;s locked so only that website can read it.</p>
      <div className="ck-actions">
        <button type="button" className="ck-primary" onClick={onSend} disabled={blocked}>
          Send to {hostOf(origin)}
        </button>
      </div>
      <div className="ck-quiet-actions">
        <button type="button" className="ck-link" onClick={onShareNothing}>
          Share nothing instead
        </button>
      </div>
    </section>
  )
}
