import { describe, expect, it } from 'vitest'
import { checkWalletResponse } from '@smart-health-checkin/client/wallet'
import { buildResponse, describeResource, prepareItems, walletEntries } from './respond'
import { mergeFhirResources } from '../../state/workspaceState'

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition/'
const patient = { resourceType: 'Patient', id: 'p1', meta: { profile: [`${US_CORE}us-core-patient|6.1.0`] }, name: [{ given: ['Max'], family: 'Test' }] }
const condition = {
  resourceType: 'Condition',
  id: 'c1',
  meta: { profile: [`${US_CORE}us-core-condition-problems-health-concerns|6.1.0`] },
  code: { text: 'Hypertension' },
  subject: { reference: 'https://x.example/Patient/p1' },
}
const unprofiled = { resourceType: 'AllergyIntolerance', id: 'a1', code: { text: 'Peanut' } }
const fhir = mergeFhirResources({}, [
  {
    resourceType: 'Bundle',
    entry: [
      { fullUrl: 'https://x.example/Patient/p1', resource: patient },
      { fullUrl: 'https://x.example/Condition/c1', resource: condition },
      { resource: unprofiled },
    ],
  },
])

const phq2 = {
  resourceType: 'Questionnaire',
  url: 'https://example.org/Questionnaire/phq-2',
  version: '1',
  item: [
    { linkId: 'stem', type: 'display', text: 'Over the last 2 weeks…' },
    { linkId: 'q1', type: 'choice', text: 'Little interest', required: true, answerOption: [{ valueCoding: { system: 'http://loinc.org', code: 'LA6568-5', display: 'Not at all' } }] },
  ],
}

const request = {
  type: 'smart-health-checkin-request',
  version: '1',
  id: 'req-1',
  fhirVersions: ['4.0.1'],
  items: [
    { id: 'patient', title: 'Demographics', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-patient`] }, accept: ['application/fhir+json'] },
    { id: 'problems', title: 'Problems', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-condition-problems-health-concerns`] }, accept: ['application/fhir+json'] },
    { id: 'allergies', title: 'Allergies', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-allergyintolerance`] }, accept: ['application/fhir+json'] },
    { id: 'card', title: 'Card', content: { kind: 'selection.fhir', resourceTypes: ['Coverage'] }, accept: ['application/smart-health-card'] },
    { id: 'phq2', title: 'Mood', content: { kind: 'form.fhir', questionnaireCanonical: 'https://example.org/Questionnaire/phq-2|1', questionnaire: phq2 }, accept: ['application/fhir+json'] },
  ],
}

describe('SMART Health Check-in wallet', () => {
  it('keeps imported resources by fullUrl, or type and id', () => {
    expect(Object.keys(fhir)).toEqual(['https://x.example/Patient/p1', 'https://x.example/Condition/c1', 'AllergyIntolerance/a1'])
  })

  it('matches records by declared profile only', async () => {
    const prepared = await prepareItems({ request, entries: walletEntries(fhir) })
    expect(prepared.map((p) => p.kind)).toEqual(['selection', 'selection', 'selection', 'unsupported', 'form'])
    expect(prepared[1].entries.map((e) => e.resource.id)).toEqual(['c1'])
    expect(prepared[2].entries).toHaveLength(0)
    expect(prepared[3].reason).toMatch('accepts only application/smart-health-card')
  })

  it('answers every item once, with records, a form and honest statuses', async () => {
    const prepared = await prepareItems({ request, entries: walletEntries(fhir) })
    const answers = { phq2: new Map([['q1', [{ valueCoding: { system: 'http://loinc.org', code: 'LA6568-5', display: 'Not at all' } }]]]) }
    const response = buildResponse({ request, prepared, choices: { patient: false, problems: true, phq2: true }, answers, patientRef: 'https://x.example/Patient/p1' })
    expect(response.requestStatus.map((s) => `${s.item}:${s.status}`)).toEqual([
      'patient:declined',
      'problems:fulfilled',
      'allergies:unavailable',
      'card:unsupported',
      'phq2:fulfilled',
    ])
    const qr = response.artifacts.find((a) => a.fulfills.includes('phq2')).value
    expect(qr.questionnaire).toBe('https://example.org/Questionnaire/phq-2|1')
    expect(qr.item).toEqual([{ linkId: 'q1', text: 'Little interest', answer: answers.phq2.get('q1') }])
    expect(checkWalletResponse(request, response)).toEqual([])
  })

  it('describes records in plain words', () => {
    expect(describeResource(patient)).toBe('Max Test')
    expect(describeResource(condition)).toBe('Hypertension')
  })
})
