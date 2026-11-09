// The patient's answers to one check-in form, while they fill it in.
//
// Answers are keyed by where the question sits: a question outside any
// repeating group is keyed by its linkId; one inside an entry of a repeating
// group (one allergy, one insurance plan) is keyed by that entry's prefix plus
// its linkId, e.g. "allergies#2/allergy-substance". groups lists each
// repeating group's entries; review tracks what M5 filled in from the
// patient's records until they've checked it.
//
// A review "unit" is what the patient checks as one: an entry of a repeating
// group ("allergies#2/"), or a top-level question or section ("top:patient-demographics").
// Status is 'pending' (filled in, not yet checked), 'confirmed', or 'removed'
// (entries only; kept so the patient can undo, and left out of the response).

export function emptyForm() {
  return {
    answers: new Map(),
    groups: new Map(),
    review: new Map(),
    edited: new Set(),
    sources: new Map(), // unit -> ['AllergyIntolerance/123', ...]
    initial: new Map(), // key -> answers M5 filled in
    nextId: 0,
  }
}

// Older callers (and tests) pass a plain Map of linkId -> answers.
export function asForm(x) {
  if (!x) return emptyForm()
  if (x instanceof Map) return { ...emptyForm(), answers: x }
  return x
}

export const instancePrefix = (prefix, linkId, id) => `${prefix}${linkId}#${id}/`
const parentPrefix = (prefix) => prefix.replace(/[^/]+#\d+\/$/, '')

// The answers to linkId as seen from inside prefix: the nearest one, looking
// out through the enclosing entries (enableWhen within an entry refers to
// questions in that same entry).
export function lookup(form, prefix, linkId) {
  let p = prefix
  for (;;) {
    const found = form.answers.get(p + linkId)
    if (found) return found
    if (!p) return []
    p = parentPrefix(p)
  }
}

const sameCoding = (a, b) => !!a && !!b && a.code === b.code && (a.system ?? '') === (b.system ?? '')

function answerMatches(ans, ew) {
  if (ew.answerCoding) return sameCoding(ans.valueCoding, ew.answerCoding)
  if (ew.answerBoolean !== undefined) return ans.valueBoolean === ew.answerBoolean
  if (ew.answerString !== undefined) return ans.valueString === ew.answerString
  if (ew.answerInteger !== undefined) return ans.valueInteger === ew.answerInteger
  if (ew.answerDate !== undefined) return ans.valueDate === ew.answerDate
  return false
}

export function isEnabledAt(item, form, prefix = '') {
  if (!item.enableWhen?.length) return true
  const results = item.enableWhen.map((ew) => {
    const given = lookup(form, prefix, ew.question)
    if (ew.operator === 'exists') return given.length > 0 === (ew.answerBoolean ?? true)
    if (ew.operator === '=') return given.some((a) => answerMatches(a, ew))
    if (ew.operator === '!=') return given.length > 0 && !given.some((a) => answerMatches(a, ew))
    return false
  })
  return (item.enableBehavior ?? 'any') === 'all' ? results.every(Boolean) : results.some(Boolean)
}

// The review unit a key belongs to: its innermost entry, else its top-level item.
export function unitOf(questionnaire, key) {
  const slash = key.lastIndexOf('/')
  if (slash >= 0) return key.slice(0, slash + 1)
  const top = topLevelOf(questionnaire).get(key)
  return top ? `top:${top}` : `top:${key}`
}

const topCache = new WeakMap()
function topLevelOf(questionnaire) {
  if (topCache.has(questionnaire)) return topCache.get(questionnaire)
  const map = new Map()
  const walk = (items = [], top) => {
    for (const i of items) {
      map.set(i.linkId, top ?? i.linkId)
      // Children of a repeating group are keyed under its entries, not here.
      if (!(i.type === 'group' && i.repeats)) walk(i.item, top ?? i.linkId)
    }
  }
  walk(questionnaire.item)
  topCache.set(questionnaire, map)
  return map
}

// --- changes (each returns a new form) -------------------------------------

const clone = (f) => ({
  ...f,
  answers: new Map(f.answers),
  groups: new Map(f.groups),
  review: new Map(f.review),
  edited: new Set(f.edited),
})

export function setAnswer(form, questionnaire, key, list) {
  const next = clone(form)
  if (list.length) next.answers.set(key, list)
  else next.answers.delete(key)
  const unit = unitOf(questionnaire, key)
  if (next.review.has(unit)) {
    const changed = [...next.answers.keys(), ...next.initial.keys()].some(
      (k) => unitOf(questionnaire, k) === unit && JSON.stringify(next.answers.get(k) ?? []) !== JSON.stringify(next.initial.get(k) ?? []),
    )
    if (changed) next.edited.add(unit)
    else next.edited.delete(unit)
    // A change after checking it means it needs checking again.
    if (next.review.get(unit) === 'confirmed') next.review.set(unit, 'pending')
  }
  return next
}

export function addEntry(form, groupKey) {
  const next = clone(form)
  next.groups.set(groupKey, [...(next.groups.get(groupKey) ?? []), next.nextId])
  next.nextId += 1
  return next
}

// An entry M5 filled in is marked removed (it can be undone); one the
// patient added is simply dropped.
export function removeEntry(form, groupKey, id) {
  const next = clone(form)
  const prefix = `${groupKey}#${id}/`
  if (next.review.has(prefix)) {
    next.review.set(prefix, 'removed')
    return next
  }
  next.groups.set(groupKey, (next.groups.get(groupKey) ?? []).filter((x) => x !== id))
  for (const k of [...next.answers.keys()]) if (k.startsWith(prefix)) next.answers.delete(k)
  for (const g of [...next.groups.keys()]) if (g.startsWith(prefix)) next.groups.delete(g)
  return next
}

export function setReview(form, unit, status) {
  const next = clone(form)
  next.review.set(unit, status)
  return next
}

export function confirmAll(form, units) {
  const next = clone(form)
  for (const u of units) if (next.review.get(u) === 'pending') next.review.set(u, 'confirmed')
  return next
}

const isRemoved = (form, prefix) => {
  for (let p = prefix; p; p = parentPrefix(p)) if (form.review.get(p) === 'removed') return true
  return false
}

// --- reading it ------------------------------------------------------------

// Hidden, removed and unanswered questions are left out.
export function responseItems(questionnaire, form) {
  const build = (items = [], prefix) =>
    items
      .filter((i) => i.type !== 'display' && isEnabledAt(i, form, prefix))
      .flatMap((i) => {
        const head = { linkId: i.linkId, ...(i.text ? { text: i.text } : {}) }
        if (i.type === 'group' && i.repeats) {
          return (form.groups.get(prefix + i.linkId) ?? [])
            .map((id) => instancePrefix(prefix, i.linkId, id))
            .filter((p) => !isRemoved(form, p))
            .map((p) => build(i.item, p))
            .filter((children) => children.length)
            .map((children) => ({ ...head, item: children }))
        }
        if (i.type === 'group') {
          const children = build(i.item, prefix)
          return children.length ? [{ ...head, item: children }] : []
        }
        const given = form.answers.get(prefix + i.linkId)
        return given?.length ? [{ ...head, answer: given }] : []
      })
  return build(questionnaire.item, '')
}

export function missingRequired(questionnaire, form) {
  const missing = []
  const walk = (items = [], prefix) => {
    for (const i of items) {
      if (!isEnabledAt(i, form, prefix)) continue
      if (i.type === 'group' && i.repeats) {
        for (const id of form.groups.get(prefix + i.linkId) ?? []) {
          const p = instancePrefix(prefix, i.linkId, id)
          if (!isRemoved(form, p)) walk(i.item, p)
        }
      } else if (i.type === 'group') walk(i.item, prefix)
      else if (i.required && i.type !== 'display' && !form.answers.get(prefix + i.linkId)?.length) missing.push(i.text ?? i.linkId)
    }
  }
  walk(questionnaire.item, '')
  return missing
}

// What M5 filled in that the patient hasn't checked yet.
export function pendingReview(form) {
  return [...form.review].filter(([unit, status]) => status === 'pending' && !isRemoved(form, unit.startsWith('top:') ? '' : unit)).map(([unit]) => unit)
}

// --- from the prefill ------------------------------------------------------

// Turns populate()'s draft QuestionnaireResponse (and where each answer came
// from) into a form the patient reviews: every entry and every top-level
// section M5 filled in starts as 'pending'.
export function formFromPrefill(questionnaire, response, origins = []) {
  const form = emptyForm()
  const sourceAt = new Map(origins.map((o) => [o.path, o.source]))
  const addSource = (unit, src) => {
    if (!src) return
    const list = form.sources.get(unit) ?? []
    if (!list.includes(src)) form.sources.set(unit, [...list, src])
  }
  const fill = (qItems = [], rItems = [], prefix, path, unit) => {
    for (const qi of qItems) {
      const matches = rItems.filter((r) => r.linkId === qi.linkId)
      const here = `${path}/${qi.linkId}`
      if (qi.type === 'group' && qi.repeats) {
        const ids = matches.map((m, i) => {
          const id = form.nextId
          form.nextId += 1
          const p = instancePrefix(prefix, qi.linkId, id)
          form.review.set(p, 'pending')
          fill(qi.item, m.item, p, `${here}[${i}]`, p)
          return id
        })
        if (ids.length) form.groups.set(prefix + qi.linkId, ids)
      } else if (qi.type === 'group') {
        if (matches[0]) fill(qi.item, matches[0].item, prefix, here, unit ?? `top:${qi.linkId}`)
      } else if (matches[0]?.answer?.length) {
        const u = unit ?? `top:${qi.linkId}`
        form.answers.set(prefix + qi.linkId, matches[0].answer)
        form.initial.set(prefix + qi.linkId, matches[0].answer)
        if (!form.review.has(u)) form.review.set(u, 'pending')
        addSource(u, sourceAt.get(here))
      }
    }
  }
  fill(questionnaire.item, response.item, '', '', undefined)
  return form
}

// Whether a Questionnaire asks to be filled in from the patient's records (SDC).
export function wantsPrefill(questionnaire) {
  return JSON.stringify(questionnaire).includes('sdc-questionnaire-initialExpression')
}
