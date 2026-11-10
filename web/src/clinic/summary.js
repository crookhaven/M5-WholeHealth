// What the demo clinic's clinician sees after a check-in: the patient's
// reviewed intake answers, the records they shared, a PHQ-2 score, and where
// the patient's answers differ from their records (added, changed, or on
// record but not in the form). Pure functions over the request and the
// SMART Health Check-in response, so it can be tested without a browser.

export const PHQ2_CANONICAL = 'https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json'

// LOINC answer list LL358-3 (PHQ-9 / PHQ-2 frequency), in case the form's own
// ordinalValue isn't available.
const LOINC_SCORES = { 'LA6568-5': 0, 'LA6569-3': 1, 'LA6570-1': 2, 'LA6571-9': 3 }
const ORDINAL = 'http://hl7.org/fhir/StructureDefinition/ordinalValue'
// Records that come along because others point to them (a prescriber, a payer).
const SUPPORTING = new Set(['Practitioner', 'PractitionerRole', 'Organization', 'Location', 'Medication', 'Encounter', 'Device', 'Provenance'])
const INACTIVE_MED = new Set(['completed', 'stopped', 'cancelled', 'entered-in-error', 'ended'])

export function answerText(a) {
  if (!a) return ''
  if (a.valueCoding) return a.valueCoding.display ?? a.valueCoding.code ?? ''
  if (a.valueBoolean !== undefined) return a.valueBoolean ? 'Yes' : 'No'
  if (a.valueReference) return a.valueReference.display ?? a.valueReference.reference ?? ''
  const v = Object.values(a)[0]
  return v === undefined || v === null ? '' : String(v)
}

const answersOf = (item) => (item?.answer ?? []).map(answerText).filter(Boolean)
const firstAnswer = (items, linkId) => answersOf(findItem(items, linkId))[0] ?? ''

function findItem(items = [], linkId) {
  for (const i of items) {
    if (i.linkId === linkId) return i
    const inner = findItem(i.item, linkId)
    if (inner) return inner
  }
  return null
}

const groups = (items = [], linkId) => {
  const out = []
  const walk = (list = []) => {
    for (const i of list) {
      if (i.linkId === linkId) out.push(i.item ?? [])
      else walk(i.item)
    }
  }
  walk(items)
  return out
}

const codingsOf = (cc) => (cc?.coding ?? []).filter((c) => c.code)
const textOf = (cc) => cc?.text ?? cc?.coding?.find((c) => c.display)?.display ?? cc?.coding?.[0]?.code ?? ''
const norm = (s) => String(s ?? '').trim().toLowerCase()

function age(birthDate, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(birthDate ?? '')) return null
  const [y, m, d] = birthDate.split('-').map(Number)
  let a = today.getFullYear() - y
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) a -= 1
  return a
}

// Every resource the patient shared, once, plus which item each answered.
function sharedResources(response) {
  const byKey = new Map()
  const byItem = {}
  for (const a of response.artifacts ?? []) {
    if (a.value?.resourceType !== 'Bundle') continue
    for (const e of a.value.entry ?? []) {
      const r = e.resource
      if (!r?.resourceType) continue
      const key = `${r.resourceType}/${r.id ?? e.fullUrl}`
      if (!byKey.has(key)) byKey.set(key, r)
      if (!SUPPORTING.has(r.resourceType)) for (const item of a.fulfills ?? []) (byItem[item] ??= []).push(r)
    }
  }
  return { all: [...byKey.values()], byItem }
}

function formsByItem(response) {
  const out = {}
  for (const a of response.artifacts ?? []) {
    if (a.value?.resourceType !== 'QuestionnaireResponse') continue
    for (const item of a.fulfills ?? []) out[item] = a.value
  }
  return out
}

// --- PHQ-2 -------------------------------------------------------------------

function scoreOf(answer, questionnaire, linkId) {
  const c = answer?.valueCoding
  if (!c) return null
  const q = questionnaire && findItem(questionnaire.item, linkId)
  const option = q?.answerOption?.find((o) => o.valueCoding?.code === c.code && (o.valueCoding.system ?? '') === (c.system ?? ''))
  const ext = [...(option?.extension ?? []), ...(option?.valueCoding?.extension ?? [])].find((e) => e.url === ORDINAL)
  if (ext) return Number(ext.valueDecimal ?? ext.valueInteger)
  return LOINC_SCORES[c.code] ?? null
}

export function phq2Score(qr, questionnaire) {
  if (!qr) return null
  const answered = []
  const walk = (items = []) => {
    for (const i of items) {
      if (i.answer?.length) answered.push(i)
      walk(i.item)
    }
  }
  walk(qr.item)
  if (!answered.length) return null
  const answers = answered.map((i) => ({ question: i.text ?? i.linkId, answer: answerText(i.answer[0]), score: scoreOf(i.answer[0], questionnaire, i.linkId) }))
  const complete = answers.every((a) => a.score !== null)
  const total = answers.reduce((n, a) => n + (a.score ?? 0), 0)
  return { answers, total, complete, positive: complete && total >= 3 }
}

// --- the patient's answers against their records ----------------------------

// One kind of list in the intake (allergies, medications…), its records, and
// how to compare them.
const LISTS = [
  {
    section: 'Allergies',
    group: 'allergies',
    key: 'allergy-substance',
    types: ['AllergyIntolerance'],
    code: (r) => r.code,
    current: (r) => !r.clinicalStatus || codingsOf(r.clinicalStatus).some((c) => c.code === 'active'),
    // A reaction can be written as coded displays or as text; either counts.
    detail: [
      {
        linkId: 'allergy-reaction',
        label: 'reaction',
        of: (r) => {
          const m = (r.reaction ?? []).flatMap((x) => x.manifestation ?? [])
          const displays = [...new Set(m.flatMap((cc) => (cc.coding ?? []).map((c) => c.display).filter(Boolean)))].join(', ')
          const texts = [...new Set(m.map((cc) => cc.text).filter(Boolean))].join(', ')
          return [displays, texts].filter(Boolean)
        },
      },
    ],
  },
  {
    section: 'Medications',
    group: 'medications',
    key: 'medication-code',
    types: ['MedicationRequest', 'MedicationStatement'],
    code: (r) => r.medicationCodeableConcept,
    current: (r) => !INACTIVE_MED.has(r.status),
    detail: [],
  },
  {
    section: 'Medical history',
    group: 'medical-history',
    key: 'medical-history-problem',
    types: ['Condition'],
    code: (r) => r.code,
    current: () => true,
    detail: [],
  },
  {
    section: 'Vaccinations',
    group: 'vaccination-history',
    key: 'immunization-vaccine',
    types: ['Immunization'],
    code: (r) => r.vaccineCode,
    current: (r) => r.status !== 'entered-in-error' && r.status !== 'not-done',
    detail: [],
  },
]

function matches(answer, cc) {
  const c = answer?.valueCoding
  const codes = codingsOf(cc)
  if (c?.code && codes.some((x) => x.code === c.code && (!x.system || !c.system || x.system === c.system))) return true
  const said = norm(answerText(answer))
  return !!said && (codes.some((x) => norm(x.display) === said) || norm(cc?.text) === said)
}

function compareList(list, intakeItems, shared) {
  const entries = groups(intakeItems, list.group).map((items) => ({ items, answer: findItem(items, list.key)?.answer?.[0] }))
  const records = shared.filter((r) => list.types.includes(r.resourceType))
  // Each form entry claims one record, so a vaccine given twice matches both doses.
  const claimed = new Set()
  const rows = entries.map(({ items, answer }) => {
    const label = answerText(answer)
    const record = records.find((r) => !claimed.has(r) && matches(answer, list.code(r)))
    if (record) claimed.add(record)
    const details = Object.fromEntries((findItem(items, list.key) ? items : []).filter((i) => i.answer?.length).map((i) => [i.linkId, answersOf(i).join(', ')]))
    const changes = record
      ? list.detail
          .map((d) => ({ label: d.label, forms: d.of(record), now: details[d.linkId] ?? '' }))
          .filter((d) => d.forms.length && d.now && !d.forms.some((f) => norm(f) === norm(d.now)))
          .map((d) => ({ label: d.label, was: d.forms[0], now: d.now }))
      : []
    return { label, details, record, status: !records.length ? 'reported' : record ? (changes.length ? 'changed' : 'confirmed') : 'added', changes }
  })
  const notInForm = entries.length || records.length ? records.filter((r) => list.current(r) && !claimed.has(r)) : []
  return { rows, notInForm, recordsShared: records.length > 0 }
}

const DEMOGRAPHICS = [
  ['first-name', 'First name', (p) => p?.name?.[0]?.given?.[0]],
  ['last-name', 'Last name', (p) => p?.name?.[0]?.family],
  ['dob', 'Date of birth', (p) => p?.birthDate],
  ['street', 'Street', (p) => p?.address?.[0]?.line?.join(', ')],
  ['city', 'City', (p) => p?.address?.[0]?.city],
  ['state', 'State', (p) => p?.address?.[0]?.state],
  ['zip', 'ZIP code', (p) => p?.address?.[0]?.postalCode],
  ['phone', 'Phone', (p) => p?.telecom?.find((t) => t.system === 'phone')?.value],
  ['email', 'Email', (p) => p?.telecom?.find((t) => t.system === 'email')?.value],
]

// --- the summary -------------------------------------------------------------

export function summarize(request, response, { phq2Questionnaire, today = new Date() } = {}) {
  const forms = formsByItem(response)
  const { all, byItem } = sharedResources(response)
  const intakeId = request.items.find((i) => i.content?.kind === 'form.fhir' && forms[i.id] && !String(forms[i.id].questionnaire).startsWith(PHQ2_CANONICAL))?.id
  const phqId = request.items.find((i) => i.content?.kind === 'form.fhir' && String(forms[i.id]?.questionnaire ?? '').startsWith(PHQ2_CANONICAL))?.id
  const intake = intakeId ? forms[intakeId].item ?? [] : []
  const patientRecord = all.find((r) => r.resourceType === 'Patient')

  const items = request.items.map((i) => {
    const s = response.requestStatus?.find((x) => x.item === i.id)
    return { id: i.id, title: i.title, status: s?.status ?? 'missing', message: s?.message, count: byItem[i.id]?.length ?? 0 }
  })

  const fromForm = (linkId) => firstAnswer(intake, linkId)
  const name = [fromForm('first-name') || patientRecord?.name?.[0]?.given?.[0], fromForm('middle-name'), fromForm('last-name') || patientRecord?.name?.[0]?.family].filter(Boolean).join(' ')
  const dob = fromForm('dob') || patientRecord?.birthDate || ''
  const patient = {
    name: name || 'Unnamed patient',
    dob,
    age: age(dob, today),
    sex: patientRecord?.gender ? patientRecord.gender[0].toUpperCase() + patientRecord.gender.slice(1) : '',
    phone: fromForm('phone') || patientRecord?.telecom?.find((t) => t.system === 'phone')?.value || '',
    email: fromForm('email'),
    address: [fromForm('street'), [fromForm('city'), fromForm('state')].filter(Boolean).join(', '), fromForm('zip')].filter(Boolean).join(' · '),
    language: fromForm('preferred-language'),
  }

  const lists = Object.fromEntries(LISTS.map((l) => [l.group, { section: l.section, ...compareList(l, intake, all) }]))

  const changes = []
  if (patientRecord && intake.length) {
    for (const [linkId, label, of] of DEMOGRAPHICS) {
      const was = of(patientRecord)
      const now = fromForm(linkId)
      if (was && now && norm(was) !== norm(now)) changes.push({ section: 'Demographics', kind: 'changed', text: `${label}: ${was} → ${now}` })
    }
  }
  for (const l of LISTS) {
    const { rows, notInForm } = lists[l.group]
    for (const r of rows) {
      if (r.status === 'added') changes.push({ section: l.section, kind: 'added', text: `${r.label} (not in the records shared)` })
      for (const c of r.changes) changes.push({ section: l.section, kind: 'changed', text: `${r.label}, ${c.label}: ${c.was} → ${c.now}` })
    }
    for (const rec of notInForm) changes.push({ section: l.section, kind: 'missing', text: `${textOf(l.code(rec)) || rec.id} is on record but not in the patient's form` })
  }

  const entriesOf = (linkId) => groups(intake, linkId).map((g) => Object.fromEntries(g.filter((i) => i.answer?.length).map((i) => [i.linkId, answersOf(i).join(', ')])))

  return {
    items,
    patient,
    lists,
    familyHistory: entriesOf('family-member-history'),
    coverage: entriesOf('coverage-information'),
    emergencyContacts: entriesOf('emergency-contact'),
    pharmacy: fromForm('preferred-pharmacy-reference'),
    social: ['smoking-status', 'pregnancy-status', 'housing-status', 'education-level', 'veteran-status', 'sexual-orientation']
      .map((id) => ({ label: findItem(intake, id)?.text, value: fromForm(id) }))
      .filter((r) => r.label && r.value),
    languages: answersOf(findItem(intake, 'languages-spoken')),
    consents: ['consent-for-treatment', 'agreement-to-pay-for-treatment', 'notice-of-privacy-practices', 'acknowledgement-for-advance-directives']
      .map((id) => {
        const section = findItem(intake, id)
        if (!section) return null
        const agreed = (section.item ?? []).find((i) => i.answer?.[0]?.valueBoolean !== undefined)?.answer[0].valueBoolean
        const date = (section.item ?? []).find((i) => i.answer?.[0]?.valueDate)?.answer[0].valueDate
        return { label: section.text ?? id, agreed: agreed === true, date: date ?? '' }
      })
      .filter(Boolean),
    phq2: phqId ? phq2Score(forms[phqId], phq2Questionnaire) : null,
    changes,
    intake,
    hasIntake: intake.length > 0,
    sharedCount: all.length,
  }
}
