import { answerText } from './summary'

// The clinician's visit summary: who, what to watch for, what the patient
// changed, then the lists, each row saying whether the patient confirmed it,
// changed it, or added it.

const STATUS_LABEL = {
  confirmed: 'Confirmed',
  changed: 'Changed by patient',
  added: 'Added by patient',
  reported: 'Patient reported',
  removed: 'Removed by patient',
}

function Badge({ status }) {
  if (!status || status === 'confirmed') return null
  return <span className={`mg-badge mg-badge-${status}`}>{STATUS_LABEL[status]}</span>
}

function fmtDate(d) {
  if (!d) return ''
  const t = new Date(`${d.slice(0, 10)}T12:00:00`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function ListCard({ title, list, detail, empty }) {
  const rows = list?.rows ?? []
  const current = rows.filter((r) => r.status !== 'removed').length
  return (
    <section className="mg-card mg-list">
      <h2>
        {title} <span className="mg-count">{current}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mg-muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((r, n) => (
            <li key={n}>
              <span className="mg-row-main">
                <strong>{r.status === 'removed' ? <s>{r.label || 'Unnamed'}</s> : r.label || 'Unnamed'}</strong>
                {detail && <span className="mg-muted">{detail(r)}</span>}
              </span>
              <Badge status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Phq2({ phq2 }) {
  if (!phq2) {
    return (
      <section className="mg-card">
        <h2>PHQ-2</h2>
        <p className="mg-muted">Not answered.</p>
      </section>
    )
  }
  return (
    <section className={`mg-card mg-phq ${phq2.positive ? 'is-positive' : ''}`}>
      <h2>PHQ-2 depression screen</h2>
      <p className="mg-score">
        <span>{phq2.complete ? phq2.total : '–'}</span> / 6
      </p>
      <p className="mg-phq-result">
        {!phq2.complete ? 'Some answers could not be scored.' : phq2.positive ? 'Positive screen (3 or more). Consider a PHQ-9.' : 'Negative screen.'}
      </p>
      <ul className="mg-phq-answers">
        {phq2.answers.map((a, n) => (
          <li key={n}>
            <span>{a.question}</span>
            <strong>
              {a.answer}
              {a.score !== null && <span className="mg-muted"> ({a.score})</span>}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Fields({ rows }) {
  const shown = rows.filter(([, v]) => v)
  if (!shown.length) return <p className="mg-muted">Nothing given.</p>
  return (
    <dl className="mg-fields">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

// Every intake answer, by section, for anything the summary above leaves out.
function IntakeAnswers({ items }) {
  const render = (list = [], depth = 0) =>
    list.map((i, n) => {
      if (i.item?.length) {
        return (
          <div key={`${i.linkId}-${n}`} className={depth ? 'mg-intake-group' : 'mg-intake-section'}>
            {i.text && (depth ? <h4>{i.text}</h4> : <h3>{i.text}</h3>)}
            {render(i.item, depth + 1)}
          </div>
        )
      }
      return (
        <p key={`${i.linkId}-${n}`} className="mg-intake-row">
          <span>{i.text ?? i.linkId}</span>
          <strong>{(i.answer ?? []).map(answerText).join(', ')}</strong>
        </p>
      )
    })
  return <div className="mg-intake">{render(items)}</div>
}

const STATUS_WORDS = { fulfilled: 'Shared', partial: 'Some shared', declined: 'Not shared', unavailable: 'None on record', unsupported: "App couldn't send", error: 'Error', missing: 'No answer' }

export default function ClinicianView({ summary: s, response, receivedAt }) {
  const allergies = s.lists.allergies.rows
  const activeAllergies = allergies.filter((a) => a.status !== 'removed')
  const insurance = s.coverage[0]
  const changes = s.changes
  return (
    <main className="mg-main mg-chart">
      <section className="mg-patient" aria-label="Patient">
        <div>
          <h1>{s.patient.name}</h1>
          <p>
            {[s.patient.age !== null ? `${s.patient.age} y` : null, s.patient.sex, s.patient.dob && `DOB ${fmtDate(s.patient.dob)}`].filter(Boolean).join(' · ')}
          </p>
          <p className="mg-muted">{[s.patient.phone, s.patient.address, s.patient.language].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="mg-patient-side">
          {insurance && <p className="mg-chip">{insurance['insurance-provider'] ?? 'Insurance'}</p>}
          <p className="mg-muted">
            Checked in with M5 Whole Health{receivedAt ? ` at ${receivedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
        </div>
      </section>

      <section className={`mg-allergies ${activeAllergies.length ? '' : 'is-none'}`} aria-label="Allergies">
        <h2>Allergies</h2>
        {allergies.length ? (
          <ul>
            {allergies.map((a, n) => (
              <li key={n} className={a.status === 'removed' ? 'is-removed' : undefined}>
                <strong>{a.status === 'removed' ? <s>{a.label}</s> : a.label}</strong>
                {a.details['allergy-reaction'] && <span> ({a.details['allergy-reaction']})</span>}
                <Badge status={a.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p>No known allergies reported.</p>
        )}
      </section>

      <div className="mg-grid">
        <div className="mg-col-main">
          {changes.length > 0 && (
            <section className="mg-card mg-changes">
              <h2>What the patient changed</h2>
              <p className="mg-muted">Where the patient&apos;s reviewed answers differ from the records they shared.</p>
              <ul>
                {changes.map((c, n) => (
                  <li key={n} className={`is-${c.kind}`}>
                    <span className="mg-change-kind">{{ added: 'Added', changed: 'Changed', removed: 'Removed', missing: 'Not in form' }[c.kind]}</span>
                    <span>
                      <span className="mg-muted">{c.section}: </span>
                      {c.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ListCard
            title="Current medications"
            list={s.lists.medications}
            empty="None reported."
            detail={(r) => r.details['medication-note']}
          />
          <ListCard
            title="Medical history"
            list={s.lists['medical-history']}
            empty="None reported."
            detail={(r) => [r.details['medical-history-clinical-status'], r.details['medical-history-onset'] && `since ${fmtDate(r.details['medical-history-onset'])}`].filter(Boolean).join(', ')}
          />
          <ListCard title="Vaccinations" list={s.lists['vaccination-history']} empty="None reported." detail={(r) => fmtDate(r.details['immunization-date'])} />
          <section className="mg-card mg-list">
            <h2>Family history</h2>
            {s.familyHistory.length ? (
              <ul>
                {s.familyHistory.map((f, n) => (
                  <li key={n}>
                    <span className="mg-row-main">
                      <strong>{f['family-member-history-problem'] ?? 'Unnamed'}</strong>
                      <span className="mg-muted">
                        {[f['family-member-history-relationship'], f['family-member-history-deceased'] === 'Yes' ? 'deceased' : null].filter(Boolean).join(', ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mg-muted">None reported.</p>
            )}
          </section>
        </div>

        <div className="mg-col-side">
          <Phq2 phq2={s.phq2} />
          <section className="mg-card">
            <h2>Insurance</h2>
            {s.coverage.length ? (
              s.coverage.map((c, n) => (
                <Fields
                  key={n}
                  rows={[
                    ['Plan', c['insurance-provider']],
                    ['Member ID', c['subscriber-id']],
                    ['Relationship', c['relationship-to-subscriber']],
                  ]}
                />
              ))
            ) : (
              <p className="mg-muted">None given.</p>
            )}
          </section>
          <section className="mg-card">
            <h2>Emergency contact</h2>
            {s.emergencyContacts.length ? (
              s.emergencyContacts.map((c, n) => (
                <Fields
                  key={n}
                  rows={[
                    ['Name', [c['emergency-contact-first-name'], c['emergency-contact-middle-name'], c['emergency-contact-last-name']].filter(Boolean).join(' ')],
                    ['Phone', c['emergency-contact-phone']],
                  ]}
                />
              ))
            ) : (
              <p className="mg-muted">None given.</p>
            )}
          </section>
          <section className="mg-card">
            <h2>Social history</h2>
            <Fields rows={[...s.social.map((r) => [r.label, r.value]), ['Languages', s.languages.join(', ')], ['Pharmacy', s.pharmacy]]} />
          </section>
          {s.consents.length > 0 && (
            <section className="mg-card">
              <h2>Consents</h2>
              <ul className="mg-consents">
                {s.consents.map((c, n) => (
                  <li key={n} className={c.agreed ? 'is-yes' : 'is-no'}>
                    <span aria-hidden="true">{c.agreed ? '✓' : '–'}</span> {c.label}
                    {c.date && <span className="mg-muted"> · {fmtDate(c.date)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="mg-card">
            <h2>What came in</h2>
            <ul className="mg-received">
              {s.items.map((i) => (
                <li key={i.id}>
                  <span>{i.title}</span>
                  <span className={`mg-status mg-status-${i.status}`}>
                    {STATUS_WORDS[i.status] ?? i.status}
                    {i.count ? ` · ${i.count}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {s.hasIntake && (
        <details className="mg-card mg-more">
          <summary>All intake answers</summary>
          <IntakeAnswers items={s.intake} />
        </details>
      )}
      <details className="mg-card mg-more">
        <summary>What the app sent (FHIR)</summary>
        <pre>{JSON.stringify(response, null, 2)}</pre>
      </details>
    </main>
  )
}
