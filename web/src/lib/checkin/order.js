// The order M5 shows a check-in request's items in. The response doesn't
// depend on it (each answer carries its item's id), so the wallet can lay the
// screen out the way a patient reads it, following the intake questionnaire
// M5's own form is derived from (Medplum's): first the forms filled in from
// the patient's records, then the records themselves in the same order as
// that form's sections, then forms that start blank (PHQ-2 and the like),
// then anything M5 can't answer.

// Medplum intake section order: Demographics, Emergency Contact, Allergies,
// Current medications, Medical History, Family Member History, Vaccination
// History, Coverage Information, Social Determinants of Health.
const SECTION_ORDER = [
  'Patient',
  'RelatedPerson',
  'AllergyIntolerance',
  'MedicationStatement',
  'MedicationRequest',
  'Medication',
  'Condition',
  'FamilyMemberHistory',
  'Immunization',
  'Coverage',
  'Observation',
]

const PROFILE_TYPES = [
  [/patient/i, 'Patient'],
  [/relatedperson/i, 'RelatedPerson'],
  [/allergyintolerance/i, 'AllergyIntolerance'],
  [/medicationstatement/i, 'MedicationStatement'],
  [/medicationrequest|medicationdispense/i, 'MedicationRequest'],
  [/medication/i, 'Medication'],
  [/condition|problem|health-concern/i, 'Condition'],
  [/familymemberhistory/i, 'FamilyMemberHistory'],
  [/immunization/i, 'Immunization'],
  [/coverage|insurance|c4dic/i, 'Coverage'],
  [/observation|smokingstatus|vital|lab|sdoh/i, 'Observation'],
]

// What kind of record a records item asks for: from its matches, else from
// what it names (resource types, then profile URLs).
export function selectionType(p) {
  const fromRecords = p.records?.[0]?.resource?.resourceType
  if (fromRecords) return fromRecords
  const c = p.item?.content ?? {}
  if (c.resourceTypes?.length) return c.resourceTypes[0]
  for (const url of [...(c.profiles ?? []), ...(c.profilesFrom ?? [])]) {
    const name = String(url).split('/').pop()
    const hit = PROFILE_TYPES.find(([re]) => re.test(name))
    if (hit) return hit[1]
  }
  return null
}

function sectionRank(p) {
  const i = SECTION_ORDER.indexOf(selectionType(p))
  return i < 0 ? SECTION_ORDER.length : i
}

// prefilled: ids of form items M5 filled in from records.
export function displayOrder(prepared, prefilled = new Set()) {
  const group = (p) => {
    if (p.kind === 'form') return prefilled.has(p.item.id) ? 0 : 2
    if (p.kind === 'selection') return 1
    return 3
  }
  return prepared
    .map((p, index) => ({ p, index }))
    .sort((a, b) => group(a.p) - group(b.p) || (group(a.p) === 1 ? sectionRank(a.p) - sectionRank(b.p) : 0) || a.index - b.index)
    .map(({ p }) => p)
}
