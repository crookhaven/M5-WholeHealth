import { useEffect, useMemo, useState } from 'react'
import { webWallet } from '@smart-health-checkin/client'
import { CheckinPicker } from '@smart-health-checkin/client/react'
import m5Icon from '../assets/logo.svg?inline'
import { clinicRequest } from './request'
import { PHQ2_CANONICAL, summarize } from './summary'
import ClinicianView from './ClinicianView'

// A made-up clinic for demos: the patient checks in with M5 here, then the
// page switches to what a clinician would see. It runs the real SMART Health
// Check-in flow with the project's own library; the answer stays in this page.

// M5 at the address this page is served from (GitHub Pages or local).
const M5_URL = new URL(`${import.meta.env.BASE_URL}?checkin`, window.location.origin).href

const m5 = webWallet({
  id: 'm5-whole-health',
  name: 'M5 Whole Health',
  walletUrl: M5_URL,
  description: 'Your records, filled in and checked by you',
  iconUrl: m5Icon,
  target: 'tab',
})

function Header({ view, setView, hasResult }) {
  return (
    <>
      <div className="mg-demo" role="note">
        <strong>Demo clinic.</strong> Maple Grove Family Medicine is made up. Use test data, or your own records only if you&apos;re
        comfortable: nothing leaves this page.
      </div>
      <header className="mg-header">
        <div className="mg-brand">
          <span className="mg-logo" aria-hidden="true" />
          <div>
            <p className="mg-name">Maple Grove Family Medicine</p>
            <p className="mg-tag">Online check-in</p>
          </div>
        </div>
        <nav className="mg-tabs" aria-label="Demo views">
          <button type="button" aria-pressed={view === 'patient'} onClick={() => setView('patient')}>
            Patient check-in
          </button>
          <button type="button" aria-pressed={view === 'clinician'} onClick={() => setView('clinician')}>
            Clinician view{hasResult ? '' : ' (waiting)'}
          </button>
        </nav>
      </header>
    </>
  )
}

function PatientCheckin({ request, result, onResponse, onReset }) {
  const [note, setNote] = useState(null)
  if (result) {
    return (
      <main className="mg-main mg-narrow">
        <section className="mg-card mg-done">
          <h1>You&apos;re checked in</h1>
          <p>Thanks. Your care team has your information for today&apos;s visit.</p>
          <button type="button" className="mg-link" onClick={onReset}>
            Start over
          </button>
        </section>
      </main>
    )
  }
  return (
    <main className="mg-main mg-narrow">
      <section className="mg-card">
        <p className="mg-appt">Today, 2:30 PM · Dr. Ana Ruiz (made up)</p>
        <h1>Check in for your visit</h1>
        <p>
          Save time at the front desk. Use your health app to send us your intake form and the health records we need. You
          choose what to share.
        </p>
        <details className="mg-asks">
          <summary>What we ask for ({request.items.length} things)</summary>
          <ul>
            {request.items.map((i) => (
              <li key={i.id}>{i.title}</li>
            ))}
          </ul>
        </details>
      </section>
      <CheckinPicker
        className="mg-picker"
        request={request}
        wallets={[m5]}
        heading="Check in with your health app"
        description="Your app opens in a new tab. When you finish there, you come back here."
        theme="light"
        onResponse={({ response }) => {
          setNote(null)
          // The library hands back a checked response; .json is the response as sent.
          if (response) onResponse(response.json)
        }}
        onDeclined={() => setNote('Nothing was shared. You can try again, or check in at the front desk.')}
        onError={({ message }) => setNote(`That didn't work: ${message}`)}
      />
      {note && <p className="mg-note">{note}</p>}
    </main>
  )
}

export default function ClinicApp() {
  const [request, setRequest] = useState(() => clinicRequest())
  const [response, setResponse] = useState(null)
  const [receivedAt, setReceivedAt] = useState(null)
  const [view, setView] = useState('patient')
  const [phq2, setPhq2] = useState(null)

  // The PHQ-2 form gives each answer's score; without it, LOINC codes are used.
  useEffect(() => {
    let live = true
    fetch(PHQ2_CANONICAL)
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => live && setPhq2(q))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const summary = useMemo(() => (response ? summarize(request, response, { phq2Questionnaire: phq2 }) : null), [request, response, phq2])

  return (
    <div className="mg">
      <Header view={view} setView={setView} hasResult={!!response} />
      {view === 'patient' ? (
        <PatientCheckin
          request={request}
          result={response}
          onResponse={(r) => {
            setResponse(r)
            setReceivedAt(new Date())
            setView('clinician')
          }}
          onReset={() => {
            setResponse(null)
            setRequest(clinicRequest())
          }}
        />
      ) : summary ? (
        <ClinicianView summary={summary} response={response} receivedAt={receivedAt} />
      ) : (
        <main className="mg-main mg-narrow">
          <section className="mg-card">
            <h1>No check-in yet</h1>
            <p>When the patient checks in, their visit summary shows up here.</p>
            <button type="button" className="mg-button" onClick={() => setView('patient')}>
              Go to patient check-in
            </button>
          </section>
        </main>
      )}
    </div>
  )
}
