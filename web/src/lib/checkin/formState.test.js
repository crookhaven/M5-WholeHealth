import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { populate } from './populate'
import {
  addEntry,
  confirmAll,
  formFromPrefill,
  isEnabledAt,
  missingRequired,
  pendingReview,
  removeEntry,
  responseItems,
  setAnswer,
  setReview,
  unitOf,
  wantsPrefill,
} from './formState'

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
const intake = read('../../../public/questionnaires/patient-intake.json')
const maximus = read('../../../../synthetic-patients/maximus-decimus-meridius/maximus-decimus-meridius.json')
const resources = maximus.entry.map((e) => e.resource)
const patient = resources.find((r) => r.resourceType === 'Patient')

function prefilled() {
  const { response, origins } = populate(intake, { patient, resources })
  return formFromPrefill(intake, response, origins)
}

const find = (items, linkId) => {
  const out = []
  const walk = (list = []) => list.forEach((i) => (i.linkId === linkId && out.push(i), walk(i.item)))
  walk(items)
  return out
}

describe('check-in form state', () => {
  it('knows which forms ask to be prefilled', () => {
    expect(wantsPrefill(intake)).toBe(true)
    expect(wantsPrefill({ item: [{ linkId: 'q1', type: 'string' }] })).toBe(false)
  })

  it('turns the prefill into entries the patient has to check, each with its source record', () => {
    const form = prefilled()
    const allergies = form.groups.get('allergies')
    expect(allergies).toHaveLength(4)
    const first = `allergies#${allergies[0]}/`
    expect(form.answers.get(`${first}allergy-substance`)[0].valueCoding.display).toBe('penicillin G')
    expect(form.sources.get(first)).toEqual([expect.stringMatching(/^AllergyIntolerance\//)])
    expect(form.sources.get('top:patient-demographics')).toEqual([`Patient/${patient.id}`])
    expect(form.review.get(first)).toBe('pending')
    expect(pendingReview(form)).toContain('top:patient-demographics')
    // Nothing is missing that the form needs
    expect(missingRequired(intake, form)).toEqual([])
  })

  it('sends exactly what was prefilled once it is all checked', () => {
    const form = confirmAll(prefilled(), pendingReview(prefilled()))
    expect(pendingReview(form)).toEqual([])
    const { response } = populate(intake, { patient, resources })
    expect(responseItems(intake, form)).toEqual(response.item)
  })

  it('flags a changed entry for checking again, and knows it was changed', () => {
    let form = prefilled()
    const key = `allergies#${form.groups.get('allergies')[1]}/allergy-reaction`
    const unit = unitOf(intake, key)
    form = setReview(form, unit, 'confirmed')
    form = setAnswer(form, intake, key, [{ valueString: 'Swelling of the lips' }])
    expect(form.edited.has(unit)).toBe(true)
    expect(form.review.get(unit)).toBe('pending')
    // Changing it back to what the record said is no longer an edit
    form = setAnswer(form, intake, key, prefilled().answers.get(key))
    expect(form.edited.has(unit)).toBe(false)
    // Top-level questions belong to their section
    expect(unitOf(intake, 'city')).toBe('top:patient-demographics')
  })

  it('leaves a removed entry out of the response, and can undo it', () => {
    let form = prefilled()
    const count = form.groups.get('medications').length
    const id = form.groups.get('medications')[0]
    form = removeEntry(form, 'medications', id)
    expect(form.review.get(`medications#${id}/`)).toBe('removed')
    expect(pendingReview(form)).not.toContain(`medications#${id}/`)
    expect(find(responseItems(intake, form), 'medications')).toHaveLength(count - 1)
    // …and listed in the form's hidden "Removed by the patient" section, with its record
    const removed = find(responseItems(intake, form), 'removed-from-records')
    expect(removed).toHaveLength(1)
    expect(removed[0].item.find((i) => i.linkId === 'removed-section').answer).toEqual([{ valueString: 'Current medications' }])
    expect(removed[0].item.find((i) => i.linkId === 'removed-item').answer[0].valueCoding.display).toBe(form.answers.get(`medications#${id}/medication-code`)[0].valueCoding.display)
    expect(removed[0].item.find((i) => i.linkId === 'removed-record').answer[0].valueString).toMatch(/^MedicationRequest\//)
    form = setReview(form, `medications#${id}/`, 'pending')
    expect(find(responseItems(intake, form), 'medications')).toHaveLength(count)
    expect(find(responseItems(intake, form), 'removed-from-records')).toEqual([])
  })

  it('adds entries the patient types in, and drops them outright when removed', () => {
    let form = prefilled()
    form = addEntry(form, 'allergies')
    const id = form.groups.get('allergies').at(-1)
    form = setAnswer(form, intake, `allergies#${id}/allergy-substance`, [{ valueString: 'Bee stings' }])
    const sent = find(responseItems(intake, form), 'allergy-substance').map((i) => i.answer[0])
    expect(sent.at(-1)).toEqual({ valueString: 'Bee stings' })
    expect(form.review.has(`allergies#${id}/`)).toBe(false) // nothing to check: the patient wrote it
    form = removeEntry(form, 'allergies', id)
    expect(form.groups.get('allergies')).toHaveLength(4)
    expect(form.answers.has(`allergies#${id}/allergy-substance`)).toBe(false)
  })

  it('applies show-when rules within each entry, and requires what an added entry needs', () => {
    let form = addEntry(prefilled(), 'coverage-information')
    const id = form.groups.get('coverage-information').at(-1)
    const p = `coverage-information#${id}/`
    expect(missingRequired(intake, form)).toEqual(['Insurance company', 'Subscriber ID', 'Relationship to Subscriber'])
    const spouse = { valueCoding: { system: 'http://terminology.hl7.org/CodeSystem/subscriber-relationship', code: 'spouse', display: 'Spouse' } }
    form = setAnswer(form, intake, `${p}relationship-to-subscriber`, [spouse])
    const subscriberGroup = find(intake.item, 'related-person')[0]
    expect(isEnabledAt(subscriberGroup, form, p)).toBe(true)
    // The prefilled plans are "Self", so their subscriber section stays hidden
    const first = `coverage-information#${form.groups.get('coverage-information')[0]}/`
    expect(isEnabledAt(subscriberGroup, form, first)).toBe(false)
  })
})
