// Questionnaires in SMART Health Check-in form items (spec §5.4.2): getting
// the form, which questions show, and the QuestionnaireResponse.

const splitCanonical = (c) => {
  const bar = c.indexOf('|')
  return bar < 0 ? { url: c, version: undefined } : { url: c.slice(0, bar), version: c.slice(bar + 1) }
}

// The inline Questionnaire, or the one at the canonical (its version must match).
export async function resolveQuestionnaire(content, fetchImpl = globalThis.fetch) {
  if (content.questionnaire) {
    if (content.questionnaire.resourceType !== 'Questionnaire') throw new Error('The form sent is not a Questionnaire.')
    return content.questionnaire
  }
  if (!content.questionnaireCanonical) throw new Error('The form item has no questionnaire.')
  const { url, version } = splitCanonical(content.questionnaireCanonical)
  let res
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/fhir+json, application/json' } })
  } catch {
    throw new Error(`Could not get the form from ${url}.`)
  }
  if (!res.ok) throw new Error(`Could not get the form from ${url} (${res.status}).`)
  const q = await res.json()
  if (q.resourceType !== 'Questionnaire' || q.url !== url) throw new Error(`${url} did not return that form.`)
  if (version !== undefined && q.version !== version) throw new Error(`${url} is version ${q.version ?? 'unknown'}, not ${version}.`)
  return q
}

const sameCoding = (a, b) => !!a && !!b && a.code === b.code && (a.system ?? '') === (b.system ?? '')

function answerMatches(ans, ew) {
  if (ew.answerCoding) return sameCoding(ans.valueCoding, ew.answerCoding)
  if (ew.answerBoolean !== undefined) return ans.valueBoolean === ew.answerBoolean
  if (ew.answerString !== undefined) return ans.valueString === ew.answerString
  if (ew.answerInteger !== undefined) return ans.valueInteger === ew.answerInteger
  return false
}

// Whether a question shows, given the answers so far (enableWhen).
export function isEnabled(item, answers) {
  if (!item.enableWhen?.length) return true
  const results = item.enableWhen.map((ew) => {
    const given = answers.get(ew.question) ?? []
    if (ew.operator === 'exists') return given.length > 0 === (ew.answerBoolean ?? true)
    if (ew.operator === '=') return given.some((a) => answerMatches(a, ew))
    if (ew.operator === '!=') return given.length > 0 && !given.some((a) => answerMatches(a, ew))
    return false
  })
  return (item.enableBehavior ?? 'any') === 'all' ? results.every(Boolean) : results.some(Boolean)
}

// Hidden and unanswered questions are left out. The questionnaire canonical
// echoes the request exactly, |version included (§5.5).
export function buildQuestionnaireResponse(questionnaire, answers, canonical, patientRef) {
  const build = (items = []) =>
    items
      .filter((i) => i.type !== 'display' && isEnabled(i, answers))
      .flatMap((i) => {
        if (i.type === 'group') {
          const children = build(i.item)
          return children.length ? [{ linkId: i.linkId, ...(i.text ? { text: i.text } : {}), item: children }] : []
        }
        const given = answers.get(i.linkId)
        return given?.length ? [{ linkId: i.linkId, ...(i.text ? { text: i.text } : {}), answer: given }] : []
      })
  const q = questionnaire
  return {
    resourceType: 'QuestionnaireResponse',
    ...(canonical ? { questionnaire: canonical } : q.url ? { questionnaire: q.version ? `${q.url}|${q.version}` : q.url } : {}),
    status: 'completed',
    ...(patientRef ? { subject: { reference: patientRef } } : {}),
    authored: new Date().toISOString(),
    item: build(q.item),
  }
}

// Questions that need an answer before sending and don't have one.
export function missingRequired(questionnaire, answers) {
  const missing = []
  const walk = (items = []) => {
    for (const i of items) {
      if (!isEnabled(i, answers)) continue
      if (i.type === 'group') walk(i.item)
      else if (i.required && i.type !== 'display' && !(answers.get(i.linkId)?.length)) missing.push(i.text ?? i.linkId)
    }
  }
  walk(questionnaire.item)
  return missing
}
