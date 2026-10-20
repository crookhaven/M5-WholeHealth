import { useState } from 'react'
import { useWorkspace } from '../state/WorkspaceContext'
import { MIN_PASSCODE_LENGTH } from '../lib/storage/vault'

// Shown instead of the app when the saved records are encrypted.
export function LockScreen() {
  const { security } = useWorkspace()
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmStartOver, setConfirmStartOver] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await security.unlock(passcode)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <section className="import-section lock-screen" aria-label="Unlock">
      <h2>Enter your passcode</h2>
      <p>Your records in this browser are encrypted. Enter the passcode you set to open them.</p>
      <form onSubmit={submit}>
        <label className="file-label">
          Passcode
          <input type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus />
        </label>
        <button type="submit" disabled={busy || !passcode}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      {error && <p className="import-error">{error}</p>}
      <details className="start-over" open={confirmStartOver} onToggle={(e) => setConfirmStartOver(e.currentTarget.open)}>
        <summary>Forgot your passcode?</summary>
        <p>
          The passcode can&apos;t be recovered and nobody, including M5, can open the records without it. You can delete
          them and start over, then import again from your sources.
        </p>
        <button type="button" className="danger" onClick={security.startOver}>
          Delete my records and start over
        </button>
      </details>
    </section>
  )
}

// Sets or changes the passcode that encrypts the records saved in this browser.
export function PasscodeForm({ onDone }) {
  const { security } = useWorkspace()
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (first !== second) {
      setError('The two passcodes don’t match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await security.setPasscode(first)
      setFirst('')
      setSecond('')
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="passcode-form" onSubmit={submit}>
      <label className="file-label">
        {security.encrypted ? 'New passcode' : 'Passcode'}
        <input type="password" autoComplete="new-password" value={first} onChange={(e) => setFirst(e.target.value)} />
      </label>
      <label className="file-label">
        Type it again
        <input type="password" autoComplete="new-password" value={second} onChange={(e) => setSecond(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || first.length < MIN_PASSCODE_LENGTH || !second}>
        {busy ? 'Saving…' : security.encrypted ? 'Change passcode' : 'Set passcode'}
      </button>
      <p className="section-help">
        At least {MIN_PASSCODE_LENGTH} characters. If you forget it, the records can&apos;t be recovered; you would
        start over and import again.
      </p>
      {error && <p className="import-error">{error}</p>}
    </form>
  )
}

// The Import tab's section on protecting the records in this browser.
export function PasscodeSection() {
  const { security } = useWorkspace()
  const [changing, setChanging] = useState(false)
  return (
    <section className="import-section">
      <h2>Protect your records</h2>
      {security.encrypted ? (
        <>
          <p>
            Your records in this browser are encrypted with your passcode. You&apos;ll be asked for it each time you
            open M5.
          </p>
          <div className="button-row">
            <button type="button" onClick={security.lock}>
              Lock now
            </button>
            <button type="button" onClick={() => setChanging(!changing)}>
              {changing ? 'Cancel' : 'Change passcode'}
            </button>
          </div>
          {changing && <PasscodeForm onDone={() => setChanging(false)} />}
        </>
      ) : (
        <>
          <p>
            Set a passcode to encrypt the records M5 keeps in this browser, so someone else using this device
            can&apos;t read them. It&apos;s required before connecting to a health system.
          </p>
          <PasscodeForm />
        </>
      )}
    </section>
  )
}
