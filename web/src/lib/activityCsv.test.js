import { describe, expect, it } from 'vitest'
import { activityCsv } from './activityCsv'

describe('activityCsv', () => {
  it('writes one row per entry and escapes quotes', () => {
    const csv = activityCsv([{ at: '2026-10-20T15:00:00.000Z', action: 'Exported', patient: 'Sam', detail: 'PDF "summary"', purpose: 'Downloaded by you' }])
    expect(csv).toContain('"Date and time (UTC)"')
    expect(csv).toContain('"2026-10-20T15:00:00.000Z","Exported","Sam","PDF ""summary""","Downloaded by you"')
  })
})
