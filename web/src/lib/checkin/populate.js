// SDC expression-based population for M5's check-in wallet.
//
// Fills a Questionnaire from the patient's own records the way an SDC form
// filler does ($populate): launchContext %patient, root `variable`s written as
// x-fhir-query (run here against the records M5 holds, not a server),
// itemPopulationContext on groups (one group per matching record), and
// initialExpression on questions.
//
// Returns the draft QuestionnaireResponse plus, for every prefilled answer,
// the record it came from, so the review screen can say "from your
// allergy list" and the patient can confirm, change or drop it.

import fhirpath from 'fhirpath'
import r4 from 'fhirpath/fhir-context/r4/index.js'

const SDC = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/'
const LAUNCH = `${SDC}sdc-questionnaire-launchContext`
const VARIABLE = 'http://hl7.org/fhir/StructureDefinition/variable'
const CONTEXT = `${SDC}sdc-questionnaire-itemPopulationContext`
const INITIAL = `${SDC}sdc-questionnaire-initialExpression`

const ext = (el, url) => (el.extension ?? []).filter((e) => e.url === url)
const refOf = (r) => (r?.resourceType && r.id ? `${r.resourceType}/${r.id}` : undefined)

function evaluate(base, expression, env, warnings) {
  try {
    return fhirpath.evaluate(base ?? {}, expression, env, r4)
  } catch (e) {
    warnings.push(`Could not evaluate "${expression}": ${e.message}`)
    return []
  }
}

// --- x-fhir-query against local records -----------------------------------

const PATIENT_FIELDS = ['patient', 'subject', 'beneficiary', 'subscriber']
const lastSegment = (ref = '') => ref.split('/').filter(Boolean).pop()

function codesOf(value) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.flatMap((v) => (typeof v === 'string' ? [{ code: v }] : (v.coding ?? [])))
}

function tokenMatches(value, token) {
  const [system, code] = token.includes('|') ? token.split('|') : [undefined, token]
  return codesOf(value).some((c) => c.code === code && (system === undefined || system === '' || c.system === system))
}

function sortDate(r) {
  return r.effectiveDateTime ?? r.effectivePeriod?.start ?? r.effectiveInstant ?? r.issued ?? r.recordedDate ?? r.meta?.lastUpdated ?? ''
}

const FILTERS = {
  patient: (r, v) => {
    const refs = PATIENT_FIELDS.map((f) => r[f]?.reference).filter(Boolean)
    return refs.length === 0 || refs.some((ref) => lastSegment(ref) === lastSegment(v))
  },
  status: (r, v) => v.split(',').includes(r.status),
  'clinical-status': (r, v) => v.split(',').some((t) => tokenMatches(r.clinicalStatus, t)),
  category: (r, v) => v.split(',').some((t) => tokenMatches(r.category, t)),
  code: (r, v) => v.split(',').some((t) => tokenMatches(r.code, t)),
}

// "Type?a=b&c=d" with {{fhirpath}} already substituted -> searchset Bundle.
export function runLocalQuery(query, resources, warnings = []) {
  const [type, qs = ''] = query.split('?')
  let found = resources.filter((r) => r.resourceType === type)
  let sort
  let count
  const includes = []
  for (const [key, value] of new URLSearchParams(qs)) {
    if (FILTERS[key]) found = found.filter((r) => FILTERS[key](r, value))
    else if (key === '_sort') sort = value
    else if (key === '_count') count = Number.parseInt(value, 10)
    else if (key === '_include') includes.push(value)
    else warnings.push(`Ignored search parameter "${key}" in ${query}`)
  }
  if (sort === '-date') found = [...found].sort((a, b) => sortDate(b).localeCompare(sortDate(a)))
  else if (sort === 'date') found = [...found].sort((a, b) => sortDate(a).localeCompare(sortDate(b)))
  else if (sort) warnings.push(`Ignored _sort=${sort} in ${query}`)
  if (Number.isFinite(count)) found = found.slice(0, count)
  const included = []
  for (const inc of includes) {
    const [, field] = inc.split(':')
    for (const r of found) {
      for (const ref of [r[field]].flat().filter(Boolean)) {
        const target = resources.find((x) => refOf(x) === ref.reference || (ref.reference && lastSegment(ref.reference) === x.id))
        if (target && !included.includes(target)) included.push(target)
      }
    }
  }
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: found.length,
    entry: [
      ...found.map((resource) => ({ resource, search: { mode: 'match' } })),
      ...included.map((resource) => ({ resource, search: { mode: 'include' } })),
    ],
  }
}

function substitute(query, env, warnings) {
  return query.replace(/\{\{(.+?)\}\}/g, (_, e) => {
    const [v] = evaluate({}, e.trim(), env, warnings)
    return v === undefined ? '' : encodeURIComponent(String(v))
  })
}

// --- answers --------------------------------------------------------------

const sameCoding = (a, b) => a.code === b.code && (a.system ?? '') === (b.system ?? '')

function toAnswer(item, v) {
  if (v === null || v === undefined || v === '') return null
  switch (item.type) {
    case 'boolean':
      return typeof v === 'boolean' ? { valueBoolean: v } : null
    case 'integer':
      return Number.isInteger(Number(v)) ? { valueInteger: Number(v) } : null
    case 'decimal':
      return Number.isFinite(Number(v)) ? { valueDecimal: Number(v) } : null
    case 'date':
      return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(v)) ? { valueDate: String(v) } : null
    case 'dateTime':
      return { valueDateTime: String(v) }
    case 'choice':
    case 'open-choice': {
      if (typeof v === 'object' && v.code) {
        const c = { ...(v.system ? { system: v.system } : {}), code: v.code, ...(v.display ? { display: v.display } : {}) }
        const listed = (item.answerOption ?? []).find((o) => o.valueCoding && sameCoding(o.valueCoding, c))
        return { valueCoding: listed ? { ...c, display: listed.valueCoding.display ?? c.display } : c }
      }
      return typeof v === 'string' ? { valueString: v } : null
    }
    default:
      return typeof v === 'object' ? null : { valueString: String(v) }
  }
}

function fitsOptions(item, answer) {
  if (item.type !== 'choice' || !item.answerOption?.length) return true
  return item.answerOption.some((o) =>
    answer.valueCoding && o.valueCoding ? sameCoding(o.valueCoding, answer.valueCoding) : o.valueString !== undefined && o.valueString === answer.valueString,
  )
}

// --- walk -----------------------------------------------------------------

export function populate(questionnaire, { patient, resources = [] }) {
  const warnings = []
  const origins = [] // { path, linkId, source }
  const env = {}
  const launch = ext(questionnaire, LAUNCH)
  for (const l of launch) {
    const name = l.extension?.find((e) => e.url === 'name')?.valueCoding?.code
    if (name === 'patient') env.patient = patient
  }
  if (!env.patient) env.patient = patient

  const defineVariables = (el, scope) => {
    for (const v of ext(el, VARIABLE)) {
      const { name, language, expression } = v.valueExpression ?? {}
      if (!name) continue
      if (language === 'application/x-fhir-query') scope[name] = runLocalQuery(substitute(expression, scope, warnings), resources, warnings)
      else if (language === 'text/fhirpath') scope[name] = evaluate({}, expression, scope, warnings)
      else warnings.push(`Variable ${name} uses ${language}, which M5 doesn't run`)
    }
  }
  defineVariables(questionnaire, env)

  const fill = (items = [], scope, path, source) =>
    items.flatMap((item) => {
      if (item.type === 'display') return []
      const here = `${path}/${item.linkId}`
      const local = { ...scope }
      defineVariables(item, local)
      if (item.type === 'group') {
        const ctx = ext(item, CONTEXT)[0]?.valueExpression
        if (ctx?.name) {
          const records = evaluate({}, ctx.expression, local, warnings)
          const groups = (item.repeats ? records : records.slice(0, 1)).map((rec, i) => {
            const children = fill(item.item, { ...local, [ctx.name]: rec }, `${here}[${i}]`, refOf(rec) ?? source)
            return children.length ? { linkId: item.linkId, ...(item.text ? { text: item.text } : {}), item: children } : null
          })
          return groups.filter(Boolean)
        }
        const children = fill(item.item, local, here, source)
        return children.length ? [{ linkId: item.linkId, ...(item.text ? { text: item.text } : {}), item: children }] : []
      }
      const init = ext(item, INITIAL)[0]?.valueExpression
      if (!init) return []
      let values = evaluate({}, init.expression, local, warnings)
      if (!item.repeats) values = values.slice(0, 1)
      const answers = []
      for (const v of values) {
        const a = toAnswer(item, v)
        if (!a) continue
        if (!fitsOptions(item, a)) {
          warnings.push(`${item.linkId}: the record's value ${JSON.stringify(v)} isn't one of the form's choices, so it was left blank`)
          continue
        }
        if (!answers.some((x) => JSON.stringify(x) === JSON.stringify(a))) answers.push(a)
      }
      if (!answers.length) return []
      origins.push({ path: here, linkId: item.linkId, source: source ?? refOf(patient) })
      return [{ linkId: item.linkId, ...(item.text ? { text: item.text } : {}), answer: answers }]
    })

  const response = {
    resourceType: 'QuestionnaireResponse',
    questionnaire: questionnaire.version ? `${questionnaire.url}|${questionnaire.version}` : questionnaire.url,
    status: 'in-progress',
    ...(refOf(patient) ? { subject: { reference: refOf(patient) } } : {}),
    item: fill(questionnaire.item, env, '', undefined),
  }
  return { response, origins, warnings }
}
