import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fhirpath from 'fhirpath'
import r4 from 'fhirpath/fhir-context/r4/index.js'
import { describe, expect, it } from 'vitest'
import { populate, runLocalQuery } from './populate'

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
const intake = read('../../../public/questionnaires/patient-intake.json')
const maximus = read('../../../../synthetic-patients/maximus-decimus-meridius/maximus-decimus-meridius.json')

const INITIAL = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-initialExpression'
const CONTEXT = 'http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-itemPopulationContext'

function allItems(items = [], out = []) {
  for (const i of items) {
    out.push(i)
    allItems(i.item, out)
  }
  return out
}

function find(items, linkId) {
  return allItems(items).filter((i) => i.linkId === linkId)
}

const answer = (items, linkId) => find(items, linkId)[0]?.answer?.[0]

describe('M5 patient intake questionnaire', () => {
  const items = allItems(intake.item)

  it('is a standalone R4 Questionnaire at its own canonical', () => {
    expect(intake.resourceType).toBe('Questionnaire')
    expect(intake.url).toBe('https://crookhaven.github.io/M5-WholeHealth/questionnaires/patient-intake.json')
    expect(intake.derivedFrom).toEqual(['https://medplum.com/Questionnaire/patient-intake-questionnaire-example'])
  })

  it('has unique linkIds and enableWhen rules that point at real questions and choices', () => {
    const ids = items.map((i) => i.linkId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const i of items) {
      for (const ew of i.enableWhen ?? []) {
        const target = items.find((t) => t.linkId === ew.question)
        expect(target, `${i.linkId} -> ${ew.question}`).toBeDefined()
        if (ew.answerCoding && target.answerOption) {
          expect(target.answerOption.some((o) => o.valueCoding?.code === ew.answerCoding.code && o.valueCoding?.system === ew.answerCoding.system)).toBe(true)
        }
      }
    }
  })

  it('needs no terminology server and no placeholder hospital', () => {
    expect(items.filter((i) => i.answerValueSet)).toEqual([])
    expect(JSON.stringify(intake)).not.toContain('Sample Hospital')
    expect(JSON.stringify(intake)).not.toContain('example.com/pregnancy-status')
    expect(items.filter((i) => i.type === 'reference' || i.type === 'dateTime')).toEqual([])
  })

  it('makes SSN and gender identity optional', () => {
    expect(find(intake.item, 'ssn')[0].required).toBeUndefined()
    expect(find(intake.item, 'gender-identity')[0].required).toBeUndefined()
  })

  it('has prefill expressions that all compile', () => {
    const exprs = items.flatMap((i) => (i.extension ?? []).filter((e) => e.url === INITIAL || e.url === CONTEXT))
    expect(exprs.length).toBeGreaterThan(30)
    for (const e of exprs) expect(() => fhirpath.compile(e.valueExpression.expression, r4)).not.toThrow()
  })
})

describe('populate', () => {
  const resources = maximus.entry.map((e) => e.resource)
  const patient = resources.find((r) => r.resourceType === 'Patient')

  it('prefills the intake form from a synthetic patient with no warnings', () => {
    const { response, origins, warnings } = populate(intake, { patient, resources })
    expect(warnings).toEqual([])
    expect(response.questionnaire).toBe(`${intake.url}|${intake.version}`)
    expect(answer(response.item, 'first-name')).toEqual({ valueString: 'Maximus' })
    expect(answer(response.item, 'state')).toEqual({ valueString: 'IL' })
    expect(answer(response.item, 'race').valueCoding.code).toBe('2106-3')
    // One group per record, and each answer remembers which record it came from
    expect(find(response.item, 'allergies')).toHaveLength(4)
    expect(find(response.item, 'coverage-information').map((g) => answer(g.item, 'insurance-provider').valueString)).toEqual([
      'Atlas Health Plan',
      'Atlas Dental Plan',
      'Atlas Vision Plan',
    ])
    const allergyOrigin = origins.find((o) => o.linkId === 'allergy-substance')
    expect(allergyOrigin.source).toMatch(/^AllergyIntolerance\//)
    // Only the person marked as emergency contact, not every related person
    expect(find(response.item, 'emergency-contact')).toHaveLength(1)
    expect(answer(response.item, 'emergency-contact-first-name')).toEqual({ valueString: 'Juba' })
    // Only active medications
    const meds = find(response.item, 'medication-code').map((i) => i.answer[0].valueCoding.display)
    expect(meds).not.toContain('clopidogrel 75 MG Oral Tablet')
    expect(answer(response.item, 'allergy-onset')).toEqual({ valueDate: '1996-08-01' })
  })

  it('never prefills SSN, even when the record has one', () => {
    const withSsn = { ...patient, identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '000-00-0000' }] }
    const { response } = populate(intake, { patient: withSsn, resources })
    expect(find(response.item, 'ssn')).toEqual([])
  })

  it('prefills gender identity, pregnancy and sexual orientation when the records have them', () => {
    const p = {
      resourceType: 'Patient',
      id: 'p1',
      extension: [
        {
          url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-genderIdentity',
          valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '446141000124107' }] },
        },
      ],
    }
    const obs = (id, loinc, code, date) => ({
      resourceType: 'Observation',
      id,
      status: 'final',
      subject: { reference: 'Patient/p1' },
      effectiveDateTime: date,
      code: { coding: [{ system: 'http://loinc.org', code: loinc }] },
      valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code }] },
    })
    const records = [
      p,
      obs('o1', '82810-3', '60001007', '2025-01-01'),
      obs('o2', '82810-3', '77386006', '2026-10-01'),
      obs('o3', '76690-7', '42035005', '2026-01-01'),
    ]
    const { response, warnings } = populate(intake, { patient: p, resources: records })
    expect(warnings).toEqual([])
    expect(answer(response.item, 'gender-identity').valueCoding).toMatchObject({ code: '446141000124107', display: 'Female gender identity' })
    expect(answer(response.item, 'pregnancy-status').valueCoding.code).toBe('77386006') // the latest one
    expect(answer(response.item, 'sexual-orientation').valueCoding.code).toBe('42035005')
  })

  it("leaves a choice blank, with a warning, when the record's code isn't one of the choices", () => {
    const p = { resourceType: 'Patient', id: 'p2' }
    const smoking = {
      resourceType: 'Observation',
      id: 's',
      status: 'final',
      subject: { reference: 'Patient/p2' },
      code: { coding: [{ system: 'http://loinc.org', code: '72166-2' }] },
      valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '999999999' }] },
    }
    const { response, warnings } = populate(intake, { patient: p, resources: [p, smoking] })
    expect(find(response.item, 'smoking-status')).toEqual([])
    expect(warnings[0]).toMatch(/smoking-status/)
  })
})

describe('runLocalQuery', () => {
  const rs = [
    { resourceType: 'Condition', id: 'a', subject: { reference: 'Patient/x' }, category: [{ coding: [{ code: 'problem-list-item' }] }] },
    { resourceType: 'Condition', id: 'b', subject: { reference: 'Patient/x' }, category: [{ coding: [{ code: 'encounter-diagnosis' }] }] },
    { resourceType: 'Condition', id: 'c', subject: { reference: 'Patient/y' }, category: [{ coding: [{ code: 'problem-list-item' }] }] },
  ]

  it('filters by patient and token, and reports parameters it ignores', () => {
    const warnings = []
    const b = runLocalQuery('Condition?patient=x&category=problem-list-item&foo=1', rs, warnings)
    expect(b.entry.map((e) => e.resource.id)).toEqual(['a'])
    expect(warnings).toEqual(['Ignored search parameter "foo" in Condition?patient=x&category=problem-list-item&foo=1'])
  })
})
