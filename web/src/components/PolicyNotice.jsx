import { useState } from 'react'

// The date of the current terms and privacy policy. Change it whenever either
// page changes in a way people should know about, and everyone sees the notice
// again the next time they open M5.
export const POLICY_VERSION = '2026-10-19'
const KEY = 'm5-policy-seen'

function seenVersion() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

// Shown on first use, and again after the terms or privacy policy change, until
// the person confirms they've read it.
export default function PolicyNotice() {
  const [seen, setSeen] = useState(seenVersion)
  if (seen === POLICY_VERSION) return null
  const updated = seen !== null

  function accept() {
    try {
      localStorage.setItem(KEY, POLICY_VERSION)
    } catch {
      // Not remembered; the notice shows again next time.
    }
    setSeen(POLICY_VERSION)
  }

  return (
    <section className="policy-notice" role="region" aria-label="Terms and privacy">
      <p>
        {updated ? <strong>The terms and privacy policy changed on {POLICY_VERSION}. </strong> : <strong>Before you start: </strong>}
        M5 is a free, open-source demonstration. Your records stay in this browser, and nothing is shared unless you
        choose to share it. Please read the <a href="terms.html">terms</a> and{' '}
        <a href="privacy.html">privacy policy</a>. If you don&apos;t agree, don&apos;t import anything, and use Clear to
        remove what you have.
      </p>
      <button type="button" onClick={accept}>
        {updated ? 'I have read the changes' : 'I agree'}
      </button>
    </section>
  )
}
