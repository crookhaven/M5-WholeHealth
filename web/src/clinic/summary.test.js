import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildResponse, prepareItems, walletEntries } from '../lib/checkin/respond'
import { populate } from '../lib/checkin/populate'
import { addEntry, confirmAll, formFromPrefill, pendingReview, removeEntry, setAnswer } from '../lib/checkin/formState'
import { clinicRequest } from './request'
import { phq2Score, summarize } from './summary'

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
const intake = read('../../public/questionnaires/patient-intake.json')
const maximus = read('../../../synthetic-patients/maximus-decimus-meridius/maximus-decimus-meridius.json')

const ORD = 'http://hl7.org/fhir/StructureDefinition/ordinalValue'
const scale = ['LA6568-5', 'LA6569-3', 'LA6570-1', 'LA6571-9'].map((code, n) => ({
  valueCoding: { system: 'http://loinc.org', code, display: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'][n] },
  extension: [{ url: ORD, valueDecimal: n }],
}))
const phq2 = {
  resourceType: 'Questionnaire',
  url: 'https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json',
  item: [
    { linkId: 'phq2-1', type: 'choice', text: 'Little interest or pleasure in doing things', answerOption: scale },
    { linkId: 'phq2-2', type: 'choice', text: 'Feeling down, depressed, or hopeless', answerOption: scale },
  ],
}

// Maximus checks in with M5: removes penicillin, corrects a reaction, adds
// an allergy, and answers the PHQ-2 (2 + 1 = 3, a positive screen).
async function checkIn() {
  const request = clinicRequest('test')
  const resources = Object.fromEntries(maximus.entry.map((e) => [e.fullUrl, e.resource]))
  const fetchImpl = async (url) => ({ ok: true, json: async () => (url.startsWith(intake.url) ? intake : phq2) })
  const prepared = await prepareItems({ request, unsupportedItems: [], entries: walletEntries(resources), fetchImpl })
  const records = Object.values(resources)
  const patient = records.find((r) => r.resourceType === 'Patient')
  const { response: draft, origins } = populate(intake, { patient, resources: records })
  let form = formFromPrefill(intake, draft, origins)
  const penicillin = form.groups.get('allergies').find((id) => form.answers.get(`allergies#${id}/allergy-substance`)[0].valueCoding.display === 'penicillin G')
  const lisinopril = form.groups.get('allergies').find((id) => form.answers.get(`allergies#${id}/allergy-substance`)[0].valueCoding.display === 'lisinopril')
  form = removeEntry(form, 'allergies', penicillin)
  form = setAnswer(form, intake, `allergies#${lisinopril}/allergy-reaction`, [{ valueString: 'Swollen lips' }])
  form = addEntry(form, 'allergies')
  form = setAnswer(form, intake, `allergies#${form.groups.get('allergies').at(-1)}/allergy-substance`, [{ valueString: 'Bee stings' }])
  form = setAnswer(form, intake, 'city', [{ valueString: 'Shelbyville' }])
  form = confirmAll(form, pendingReview(form))
  const answers = {
    intake: form,
    phq2: new Map([
      ['phq2-1', [{ valueCoding: scale[2].valueCoding }]],
      ['phq2-2', [{ valueCoding: scale[1].valueCoding }]],
    ]),
  }
  // The penicillin record stays shared; the form says the patient removed it.
  const choices = Object.fromEntries(prepared.map((p) => [p.item.id, true]))
  const response = buildResponse({ request, prepared, choices, answers, patientRef: 'Patient/x' })
  return { request, response }
}

describe('clinician summary', () => {
  it('reads who the patient is from their reviewed answers', async () => {
    const { request, response } = await checkIn()
    const s = summarize(request, response, { phq2Questionnaire: phq2, today: new Date('2026-11-10') })
    expect(s.patient).toMatchObject({ name: 'Maximus Decimus Meridius', dob: '1978-03-15', age: 48, sex: 'Male' })
    expect(s.items.find((i) => i.id === 'family-history').status).toBe('unavailable')
    expect(s.items.find((i) => i.id === 'allergies').status).toBe('fulfilled')
    // Counts are the records asked for, not the prescribers and payers that come along
    expect(s.items.find((i) => i.id === 'medications').count).toBe(22)
    expect(s.items.find((i) => i.id === 'coverage').count).toBe(3)
  })

  it('shows the allergy list the patient confirmed, and what they changed', async () => {
    const { request, response } = await checkIn()
    const s = summarize(request, response, { phq2Questionnaire: phq2 })
    const allergies = s.lists.allergies.rows
    expect(allergies.map((r) => [r.label, r.status])).toEqual([
      ['lisinopril', 'changed'],
      ['Seafood', 'confirmed'],
      ['Latex', 'confirmed'],
      ['Bee stings', 'added'],
      ['penicillin G', 'removed'],
    ])
    expect(s.changes).toEqual(
      expect.arrayContaining([
        { section: 'Demographics', kind: 'changed', text: 'City: Springfield → Shelbyville' },
        { section: 'Allergies', kind: 'changed', text: 'lisinopril, reaction: Angioedema → Swollen lips' },
        { section: 'Allergies', kind: 'added', text: 'Bee stings (not in the records shared)' },
        { section: 'Allergies', kind: 'removed', text: 'penicillin G: the patient says this no longer applies (on their record since 1996)' },
      ]),
    )
    // Known as removed, so not also reported as missing from the form
    expect(s.changes.filter((c) => c.kind === 'missing' && /penicillin/i.test(c.text))).toEqual([])
    // Stopped medications and repeat doses of a vaccine aren't flagged as missing from the form
    expect(s.changes.filter((c) => c.section === 'Medications' && c.kind === 'missing')).toEqual([])
    expect(s.changes.filter((c) => c.section === 'Vaccinations')).toEqual([])
    expect(s.lists.medications.rows.length).toBeGreaterThan(10)
    expect(s.coverage.map((c) => c['insurance-provider'])).toEqual(['Atlas Health Plan', 'Atlas Dental Plan', 'Atlas Vision Plan'])
  })

  it('scores the PHQ-2 from the form and flags a positive screen', async () => {
    const { request, response } = await checkIn()
    const s = summarize(request, response, { phq2Questionnaire: phq2 })
    expect(s.phq2).toMatchObject({ total: 3, complete: true, positive: true })

    // Without the form, the LOINC answer codes still score it
    expect(phq2Score(response.artifacts.find((a) => a.fulfills.includes('phq2')).value).total).toBe(3)
  })
})
