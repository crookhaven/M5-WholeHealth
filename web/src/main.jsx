import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isCheckinMode, startWallet } from './lib/checkin/session'

// After a new deploy, a page opened before it still points at the old,
// now-deleted code chunks, so a lazy import fails. Reload once to pick up the
// new version (the workspace is kept in localStorage, so nothing is lost).
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('m5-reloaded-for-update')) return
    sessionStorage.setItem('m5-reloaded-for-update', '1')
  } catch {
    // Storage blocked: reload anyway; worst case the error shows again.
  }
  event.preventDefault()
  window.location.reload()
})

// Opened by a SMART Health Check-in page: say ready and take its request now,
// even if M5 is locked; it waits until the patient unlocks.
if (isCheckinMode()) startWallet()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
