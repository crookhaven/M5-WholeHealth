// The demo clinic's check-in request: M5's intake form (filled in from the
// patient's records), the records behind each part of it, in the form's
// section order, and the PHQ-2.

export const INTAKE_CANONICAL = 'https://crookhaven.github.io/M5-WholeHealth/questionnaires/patient-intake.json'
const PHQ2 = 'https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json'
const US = 'http://hl7.org/fhir/us/core/StructureDefinition/'
const FHIR = ['application/fhir+json']

const records = (id, title, selector) => ({ id, title, content: { kind: 'selection.fhir', ...selector }, accept: FHIR })
const form = (id, title, canonical) => ({ id, title, content: { kind: 'form.fhir', questionnaireCanonical: canonical }, accept: FHIR })

export function clinicRequest(id = `maple-grove-${Date.now()}`) {
  return {
    type: 'smart-health-checkin-request',
    version: '1',
    id,
    purpose: 'Check in for your visit',
    fhirVersions: ['4.0.1'],
    items: [
      form('intake', 'Patient intake', INTAKE_CANONICAL),
      records('demographics', 'Demographics', { profiles: [`${US}us-core-patient`] }),
      records('emergency-contact', 'Emergency contact', { profiles: [`${US}us-core-relatedperson`] }),
      records('allergies', 'Allergies', { profiles: [`${US}us-core-allergyintolerance`] }),
      records('medications', 'Current medications', { profiles: [`${US}us-core-medicationrequest`] }),
      records('medical-history', 'Medical history', { profiles: [`${US}us-core-condition-problems-health-concerns`] }),
      records('family-history', 'Family medical history', { resourceTypes: ['FamilyMemberHistory'] }),
      records('vaccinations', 'Vaccinations', { profiles: [`${US}us-core-immunization`] }),
      records('coverage', 'Insurance', { profiles: ['http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage', `${US}us-core-coverage`] }),
      records('social-history', 'Smoking, pregnancy and social needs', {
        profiles: [`${US}us-core-smokingstatus`, `${US}us-core-observation-pregnancystatus`, `${US}us-core-observation-sexual-orientation`, `${US}us-core-observation-screening-assessment`],
      }),
      form('phq2', 'Two questions about your mood', PHQ2),
    ],
  }
}
