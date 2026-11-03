// The web wallet hand-off: when a check-in page opens M5 with ?checkin, M5
// tells it it's ready, takes one request, and replies once (the library does
// the protocol, the origin check and the encryption). The request waits here
// until M5 is unlocked and the patient has chosen what to share.

let state = { status: 'starting' }
const listeners = new Set()

function set(next) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export const walletSession = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => state,
}

export function isCheckinMode(location = window.location) {
  return new URLSearchParams(location.search).has('checkin')
}

let started = false

export async function startWallet() {
  if (started) return
  started = true
  try {
    const { serveWebWallet } = await import('@smart-health-checkin/client/wallet')
    const served = serveWebWallet({
      onRequest: (context) =>
        new Promise((resolve) => {
          set({
            status: 'request',
            context,
            reply(answer) {
              set({ status: answer.response ? 'sent' : answer.declined ? 'cancelled' : 'failed' })
              resolve(answer)
            },
          })
        }),
      onInvalidRequest: (message, origin) => set({ status: 'invalid', error: `${origin} sent a request M5 can't read: ${message}` }),
    })
    if (!served.opened) set({ status: 'not-opened' })
    else if (state.status === 'starting') set({ status: 'waiting' })
  } catch (err) {
    set({ status: 'invalid', error: `The check-in library didn't load: ${err.message}` })
  }
}

// For tests: put the session in a given state.
export function setSessionForTests(next) {
  set(next)
}
