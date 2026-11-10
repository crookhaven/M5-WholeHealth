import { describe, expect, it } from 'vitest'
import { displayOrder, selectionType } from './order'

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition/'
const sel = (id, profile, records = []) => ({ kind: 'selection', item: { id, content: { kind: 'selection.fhir', profiles: [`${US_CORE}${profile}`] } }, records })
const form = (id) => ({ kind: 'form', item: { id } })

describe('check-in display order', () => {
  it('works out what a records item asks for, from its records or its profiles', () => {
    expect(selectionType(sel('a', 'us-core-allergyintolerance'))).toBe('AllergyIntolerance')
    expect(selectionType(sel('p', 'us-core-condition-problems-health-concerns'))).toBe('Condition')
    expect(selectionType(sel('c', 'C4DIC-Coverage'))).toBe('Coverage')
    expect(selectionType(sel('x', 'something-else', [{ resource: { resourceType: 'Immunization' } }]))).toBe('Immunization')
  })

  it('puts the prefilled intake first, records in the intake section order, then blank forms', () => {
    const prepared = [
      form('phq2'),
      sel('meds', 'us-core-medicationrequest'),
      sel('allergies', 'us-core-allergyintolerance'),
      { kind: 'unsupported', item: { id: 'card' } },
      form('intake'),
      sel('insurance', 'us-core-coverage'),
      sel('patient', 'us-core-patient'),
      sel('problems', 'us-core-condition-problems-health-concerns'),
    ]
    expect(displayOrder(prepared, new Set(['intake'])).map((p) => p.item.id)).toEqual([
      'intake',
      'patient',
      'allergies',
      'meds',
      'problems',
      'insurance',
      'phq2',
      'card',
    ])
  })

  it('keeps the request order for forms nothing was filled into', () => {
    expect(displayOrder([form('b'), form('a')]).map((p) => p.item.id)).toEqual(['b', 'a'])
  })
})
