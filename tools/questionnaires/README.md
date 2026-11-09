# Questionnaires

`build_patient_intake.py` builds M5's patient intake form,
`web/public/questionnaires/patient-intake.json`, from Medplum's patient intake
questionnaire (`source/medplum-patient-intake-questionnaire.json`, from
[medplum/medplum-patient-intake-demo](https://github.com/medplum/medplum-patient-intake-demo),
Apache License 2.0; see `source/MEDPLUM-LICENSE.txt`). Every change from
Medplum's version is made in the script, so the differences are easy to review.

Rebuild after editing the script (from the repo root):

```
python3 tools/questionnaires/build_patient_intake.py \
  tools/questionnaires/source/medplum-patient-intake-questionnaire.json \
  web/public/questionnaires/patient-intake.json
```

The published form lives at its canonical URL,
`https://crookhaven.github.io/M5-WholeHealth/questionnaires/patient-intake.json`,
so a check-in request can send it by reference.

## What changed from Medplum's version

- A standalone R4 Questionnaire with M5's own canonical URL and version
  (`derivedFrom` points at Medplum's).
- SDC expression-based population: `launchContext` %patient, `variable`
  x-fhir-queries for allergies, active medications, problem-list conditions,
  family history, immunizations, active coverage, related persons and the
  latest smoking, pregnancy and sexual-orientation Observations;
  `itemPopulationContext` on the repeating groups (one group per record);
  `initialExpression` on each question. `web/src/lib/checkin/populate.js` runs
  them against the records M5 holds.
- SSN and gender identity are optional. SSN is never prefilled.
- No value sets that need a terminology server (VSAC): small lists are inline
  `answerOption`s with codes checked against the HL7 terminology package
  (hl7.terminology.r4 7.0.1); allergies, medications, problems and vaccines are
  `open-choice` with no fixed list, so the patient's own coded records come
  through and anything new can be typed.
- Pregnancy status uses SNOMED CT Pregnant (77386006), Not pregnant (60001007)
  and Unknown (261665006) in place of `http://example.com/pregnancy-status`.
- "Sample Hospital" in the consent, payment and privacy notices is now
  `[Practice Name]`, for the practice to replace.
- Onset and vaccination dates are `date` (was `dateTime`); pharmacy and
  insurance company are free text (was a reference to an Organization, which
  needs a server to search).
- Race allows more than one answer, as US Core does.
