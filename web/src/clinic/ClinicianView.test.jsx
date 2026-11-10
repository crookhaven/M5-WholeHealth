// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ClinicianView from './ClinicianView'
import { summarize } from './summary'
import { clinicRequest } from './request'

// A small hand-made response: an intake with one changed allergy and a PHQ-2.
const request = clinicRequest('t')
const response = {
  type: 'smart-health-checkin-response',
  version: '1',
  requestId: 't',
  requestStatus: request.items.map((i) => ({ item: i.id, status: ['intake', 'allergies', 'phq2'].includes(i.id) ? 'fulfilled' : 'declined' })),
  artifacts: [
    {
      id: 'qr-intake',
      mediaType: 'application/fhir+json',
      fulfills: ['intake'],
      value: {
        resourceType: 'QuestionnaireResponse',
        questionnaire: 'https://crookhaven.github.io/M5-WholeHealth/questionnaires/patient-intake.json|0.1.0',
        status: 'completed',
        item: [
          { linkId: 'patient-demographics', text: 'Demographics', item: [
            { linkId: 'first-name', text: 'First Name', answer: [{ valueString: 'Ada' }] },
            { linkId: 'last-name', text: 'Last Name', answer: [{ valueString: 'Lovelace' }] },
          ] },
          { linkId: 'allergies', text: 'Allergies', item: [
            { linkId: 'allergy-substance', text: 'Substance', answer: [{ valueCoding: { system: 'http://snomed.info/sct', code: '91936005', display: 'Penicillin' } }] },
            { linkId: 'allergy-reaction', text: 'Reaction', answer: [{ valueString: 'Rash' }] },
          ] },
        ],
      },
    },
    {
      id: 'fhir-allergies',
      mediaType: 'application/fhir+json',
      fulfills: ['allergies'],
      value: { resourceType: 'Bundle', type: 'collection', entry: [{ fullUrl: 'urn:a1', resource: { resourceType: 'AllergyIntolerance', id: 'a1', code: { coding: [{ system: 'http://snomed.info/sct', code: '91936005', display: 'Penicillin' }] }, reaction: [{ manifestation: [{ text: 'Hives' }] }] } }] },
    },
    {
      id: 'qr-phq2',
      mediaType: 'application/fhir+json',
      fulfills: ['phq2'],
      value: { resourceType: 'QuestionnaireResponse', questionnaire: 'https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json', status: 'completed', item: [
        { linkId: 'phq2-1', text: 'Little interest', answer: [{ valueCoding: { system: 'http://loinc.org', code: 'LA6568-5', display: 'Not at all' } }] },
        { linkId: 'phq2-2', text: 'Feeling down', answer: [{ valueCoding: { system: 'http://loinc.org', code: 'LA6569-3', display: 'Several days' } }] },
      ] },
    },
  ],
}

describe('ClinicianView', () => {
  it('shows the patient, their allergies with what changed, the PHQ-2 and what came in', () => {
    render(<ClinicianView summary={summarize(request, response)} response={response} receivedAt={new Date()} />)
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    const allergies = screen.getByRole('region', { name: 'Allergies' })
    expect(within(allergies).getByText('Penicillin')).toBeInTheDocument()
    expect(within(allergies).getByText('Changed by patient')).toBeInTheDocument()
    expect(screen.getByText('Penicillin, reaction: Hives → Rash')).toBeInTheDocument()
    expect(screen.getByText('Negative screen.')).toBeInTheDocument()
    expect(screen.getAllByText('Not shared').length).toBeGreaterThan(0)
  })
})
