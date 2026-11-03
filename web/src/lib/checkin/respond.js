import { declineAll, selectEntries, selects } from '@smart-health-checkin/client/wallet'
import { buildQuestionnaireResponse, resolveQuestionnaire } from './forms'

// SMART Health Check-in, the wallet side (https://smart-health-checkin.org/spec/):
// which of the patient's records answer each item a check-in page asks for,
// and the response M5 sends back. Records are shared exactly as they were
// imported, matched by their declared profiles (spec §5.4.1), so a record from
// a source that doesn't declare US Core profiles is not offered for a US Core
// item.

const FHIR_JSON = 'application/fhir+json'
const FHIR_VERSION = '4.0.1'

// The patient's imported FHIR resources as Bundle entries.
export function walletEntries(fhirResources) {
  return Object.entries(fhirResources ?? {}).map(([fullUrl, resource]) => ({ fullUrl, resource }))
}

export function patientEntry(entries) {
  return entries.find((e) => e.resource.resourceType === 'Patient') ?? null
}

// What M5 can do with each item: share matching records, fill in a form, or
// say it can't (with why).
export async function prepareItems({ request, unsupportedItems = [], entries, fetchImpl }) {
  const unsupported = new Map(unsupportedItems.map((u) => [u.id, u.message ?? u.reason ?? 'not supported']))
  const patient = patientEntry(entries)
  return Promise.all(
    request.items.map(async (item) => {
      if (unsupported.has(item.id)) return { kind: 'unsupported', item, reason: unsupported.get(item.id) }
      if (!item.accept?.includes(FHIR_JSON)) {
        return { kind: 'unsupported', item, reason: `M5 shares FHIR JSON, and this item accepts only ${item.accept?.join(', ')}` }
      }
      if (item.content?.kind === 'selection.fhir') {
        const exclude = patient ? [patient.fullUrl] : []
        const c = item.content
        const noSelector = !c.profiles?.length && !c.profilesFrom?.length && !c.resourceTypes?.length
        // The records that answer the item, which the patient can pick from;
        // records they only point to (a prescriber, a payer) come along.
        const records = noSelector ? entries : entries.filter((e) => selects(c, e.resource))
        return { kind: 'selection', item, records, all: entries, exclude, entries: selectEntries(c, entries, { exclude }) }
      }
      if (item.content?.kind === 'form.fhir') {
        try {
          return { kind: 'form', item, questionnaire: await resolveQuestionnaire(item.content, fetchImpl) }
        } catch (err) {
          return { kind: 'unsupported', item, reason: err.message }
        }
      }
      return { kind: 'unsupported', item, reason: `M5 doesn't know the "${item.content?.kind}" kind of item` }
    }),
  )
}

const bundle = (entries) => ({
  resourceType: 'Bundle',
  type: 'collection',
  entry: entries.map((e) => ({ fullUrl: e.fullUrl, resource: e.resource })),
})

// The records the patient left ticked, with the records they point to.
export function chosenEntries(p, left = new Set()) {
  if (!left.size) return p.entries
  const kept = p.all.filter((e) => !left.has(e.fullUrl))
  return selectEntries(p.item.content, kept, { exclude: p.exclude })
}

// The response: one status per item, and the records and form answers the
// patient chose to share. choices: { [itemId]: true | false }; answers:
// { [itemId]: Map(linkId -> answers) }; leftOut: { [itemId]: Set(fullUrl) },
// records the patient unticked within an item.
export function buildResponse({ request, prepared, choices, answers, patientRef, leftOut = {} }) {
  const artifacts = []
  const requestStatus = []
  for (const p of prepared) {
    const id = p.item.id
    if (p.kind === 'unsupported') {
      requestStatus.push({ item: id, status: 'unsupported', message: p.reason })
      continue
    }
    if (p.kind === 'selection' && p.records.length === 0) {
      requestStatus.push({ item: id, status: 'unavailable', message: 'Nothing in this record matches.' })
      continue
    }
    if (!choices[id]) {
      requestStatus.push({ item: id, status: 'declined' })
      continue
    }
    if (p.kind === 'form') {
      const qr = buildQuestionnaireResponse(p.questionnaire, answers[id] ?? new Map(), p.item.content.questionnaireCanonical, patientRef)
      artifacts.push({ id: `qr-${id}`, mediaType: FHIR_JSON, fhirVersion: FHIR_VERSION, fulfills: [id], value: qr })
    } else {
      const left = leftOut[id] ?? new Set()
      const kept = p.records.filter((e) => !left.has(e.fullUrl)).length
      if (kept === 0) {
        requestStatus.push({ item: id, status: 'declined' })
        continue
      }
      artifacts.push({ id: `fhir-${id}`, mediaType: FHIR_JSON, fhirVersion: FHIR_VERSION, fulfills: [id], value: bundle(chosenEntries(p, left)) })
      if (kept < p.records.length) {
        requestStatus.push({ item: id, status: 'partial', message: `The patient chose to share ${kept} of ${p.records.length} records.` })
        continue
      }
    }
    requestStatus.push({ item: id, status: 'fulfilled' })
  }
  return { type: 'smart-health-checkin-response', version: '1', requestId: request.id, artifacts, requestStatus }
}

const firstText = (cc) => cc?.text ?? cc?.coding?.find((c) => c.display)?.display ?? cc?.coding?.[0]?.code

// One line describing a resource, for the consent screen.
export function describeResource(r) {
  switch (r.resourceType) {
    case 'Patient': {
      const n = r.name?.[0]
      return [n?.given?.join(' '), n?.family].filter(Boolean).join(' ') || n?.text || 'Patient'
    }
    case 'Condition':
    case 'Procedure':
    case 'Observation':
    case 'DiagnosticReport':
      return firstText(r.code) ?? r.resourceType
    case 'AllergyIntolerance':
      return firstText(r.code) ?? 'Allergy'
    case 'MedicationRequest':
    case 'MedicationStatement':
      return firstText(r.medicationCodeableConcept) ?? r.medicationReference?.display ?? 'Medication'
    case 'Immunization':
      return firstText(r.vaccineCode) ?? 'Immunization'
    case 'Coverage':
      return [r.payor?.[0]?.display, firstText(r.type), r.subscriberId && `member ${r.subscriberId}`].filter(Boolean).join(', ') || 'Coverage'
    case 'DocumentReference':
      return r.description ?? firstText(r.type) ?? 'Document'
    case 'Encounter':
      return firstText(r.type?.[0]) ?? 'Visit'
    default:
      return r.name?.[0]?.text ?? (typeof r.name === 'string' ? r.name : null) ?? r.resourceType
  }
}

export { declineAll }
