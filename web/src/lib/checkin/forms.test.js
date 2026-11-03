import { describe, expect, it } from 'vitest'
import { isEnabled, missingRequired, resolveQuestionnaire } from './forms'

describe('check-in forms', () => {
  it('shows follow-up questions only when their condition is met', () => {
    const follow = { linkId: 'b', type: 'string', enableWhen: [{ question: 'a', operator: '=', answerBoolean: true }] }
    expect(isEnabled(follow, new Map())).toBe(false)
    expect(isEnabled(follow, new Map([['a', [{ valueBoolean: true }]]]))).toBe(true)
  })

  it('lists needed questions without an answer', () => {
    const q = { item: [{ linkId: 'a', type: 'string', text: 'Name', required: true }, { linkId: 'b', type: 'display', required: true }] }
    expect(missingRequired(q, new Map())).toEqual(['Name'])
    expect(missingRequired(q, new Map([['a', [{ valueString: 'x' }]]]))).toEqual([])
  })

  it('fetches a form by canonical and checks its version', async () => {
    const q = { resourceType: 'Questionnaire', url: 'https://e.org/Q/x', version: '2' }
    const fetchImpl = async () => ({ ok: true, json: async () => q })
    expect(await resolveQuestionnaire({ questionnaireCanonical: 'https://e.org/Q/x|2' }, fetchImpl)).toEqual(q)
    await expect(resolveQuestionnaire({ questionnaireCanonical: 'https://e.org/Q/x|1' }, fetchImpl)).rejects.toThrow('not 1')
  })
})
