# M5 Whole Health

> \*\*Demo only.\*\* All patients, plans, and claims in this demo are synthetic. It contains no real protected health information (PHI), and you should not enter any. Plan details come from the public CMS Marketplace API for a made-up household. This is not medical, legal, or insurance advice, and it is not a HIPAA-covered service.



M⁵ Whole Health is an open-source personal and family health app built to explore the CMS Health Tech Ecosystem in practice. It brings health records, coverage information, medications, and other health data into one consumer-controlled experience using modern interoperability standards such as FHIR and SMART.

## Connectathon testing

M5 Whole Health is being built and tested in step with a series of HL7/CMS interoperability events, each one exercising a different part of the app against real external systems rather than just its own test suite.

**September 2026 -- HL7 Connectathon 43.** Demonstrated pulling in synthetic patient data, displaying it in the app, and running it through PIQI analysis against both the HL7 PIQI Clinical Data Model and the International Patient Summary (IPS) profile. Testing against the live Connectathon PIQI Gateway surfaced, and led to fixes for, two real data-normalization bugs.

**October 5, 2026 -- CMS HTE Kill the Clipboard (KTC), July GA requirements.** Tested interoperability with other organizations against the CMS Health Tech Ecosystem's Kill the Clipboard July general-availability requirements. This round added the functionality those requirements called for: SMART Health Link import fixes (direct-file links, compression, content-type parameters), new imaging/clinical-notes/referrals data, additional synthetic patient data, and plan-comparison de-duplication.

**November 2026 (planned) -- SMART Health Check-in connectathon, Nov 3.** Building a standalone test wallet (see the app's Connectathon tab, or [`web/public/test-wallet/`](web/public/test-wallet/)) for the "Kill the Clipboard" SMART Health Check-in use case: a Wallet tab that answers check-in requests, and a Verifier tab that sends them (including to itself). Scenario coverage so far: demographics/problems/medications; any-us-core (decline-all, no-selector, unknown-selector); large-response with a narrowed family history (~3.2 MB synthetic); form-by-reference and versioned-canonical forms; physician forms with conditional and repeating questions; opt-in shared artifacts; and best-effort prefilled forms. Not yet supported: SMART Health Cards (needs card signing), cross-device/in-person handoff, and write-back (an EHR-side role, not a wallet's).

### Demo clinic: check in with M5, then see the clinician view

[`clinic/`](https://crookhaven.github.io/M5-WholeHealth/clinic/) is a made-up clinic, Maple Grove Family Medicine, for showing the whole flow. It runs the real SMART Health Check-in exchange with the project's own library:

1. The clinic asks for M5's intake form (filled in from the patient's records), the records behind each part of it (demographics, emergency contact, allergies, medications, medical history, family history, vaccinations, insurance, smoking/pregnancy/social needs) and the PHQ-2.
2. The patient picks M5, checks each part step by step, and sends it.
3. The clinic switches to a **clinician view**: the patient banner, an allergy band, a scored PHQ-2 (positive at 3 or more), what the patient changed compared with the records they shared (added, changed, or on record but not in the form), the lists, insurance, emergency contact, social history, consents, and every intake answer. The response stays in the page; nothing is posted anywhere.

Source: [`web/clinic/index.html`](web/clinic/index.html) and [`web/src/clinic/`](web/src/clinic/).

## Running the app

A working implementation of the MVP below lives in [`web/`](web/) -- a
client-side React app with no backend. See [`web/README.md`](web/README.md)
for setup instructions.

# M5 Whole Health - MVP

## Purpose

Build a patient-controlled health data workspace that allows a patient to import health data, assess its quality using the PIQI framework, review findings, and selectively share information with providers.

This application is inspired by CMS Health Tech Ecosystem (HTE) and Kill the Clipboard (KTC) principles, but is not an EHR, provider portal, or clinical decision support application.

\---

# MVP User Story

As a patient,

I want to import my health information,

so that I can:

* Understand what health information I have
* Identify missing or duplicate information
* Improve my personal health record
* Decide what information to share
* Generate a shareable package for a healthcare provider

\---

# MVP Workflow

1. Import health data
2. Normalize data into a canonical record
3. Run PIQI analysis
4. Review findings
5. View health record
6. Select information to share
7. Export sharing package

\---

# Feature 1: Data Import

Support importing health information from:

## SMART Health Links (SHL)

The user should be able to:

* Paste an SHL URL
* Scan an SHL QR Code
* Retrieve the underlying health data
* Store the original SHL package

## PDF Documents

The user should be able to:

* Upload any health-related PDF
* Store the original PDF
* Extract useful information when possible

Examples:

* Apple Health exports
* Provider visit summaries
* Clinical reports
* Health plan documents

The system must be vendor-neutral.

\---

# Feature 2: Canonical Health Record

Normalize imported information into a USCDI v3-aligned record.

The MVP supports:

## Demographics

* Name
* Date of Birth
* Sex/Gender

## Medications

* Name
* Dosage
* Frequency
* Route
* Status

## Allergies

* Substance
* Reaction
* Severity

## Conditions

* Diagnosis
* Status

## Labs

* Test
* Value
* Unit
* Date

## Immunizations

* Vaccine
* Date

All records must retain source provenance.

\---

# Feature 3: PIQI Analysis

PIQI evaluates data readiness.

PIQI must analyze:

## Completeness

Examples:

* Missing dosage
* Missing frequency
* Missing reaction
* Missing units

## Duplication

Examples:

* Exact duplicates
* Probable duplicates

## Consistency

Examples:

* Conflicting medications
* Conflicting allergies

## Provenance

Examples:

* Missing source
* Unknown source

## Timeliness

Examples:

* Recently updated
* Historical
* Potentially stale

\---

# Feature 4: PIQI Findings

Each finding must include:

* What was found
* Why it was flagged
* Suggested action

Example:

Medication:
Atorvastatin

Finding:
Frequency missing

Actions:

* Review
* Ignore For Now
* Remind Me Later

Nothing is automatically changed.

\---

# Feature 5: Patient Review

Patients may:

* Confirm information
* Add patient assertions
* Ignore findings

Examples:

* Add missing dosage
* Add missing frequency
* Confirm current medication status

Patient assertions must remain separate from source records.

Source records are immutable.

\---

# Feature 6: Data Readiness Scorecard (removed)

The app's own Data Readiness Scorecard was removed. It was an M5 Whole Health
metric, not a PIQI score. Scores now come only from the PIQI Gateway and are
shown on each data set's "PIQI score" screen.



\---

# Feature 7: Human-Readable Health Dashboard

Display the patient's information in a simple format.

Example:

## Medications

Lisinopril 20 mg

Status:
Patient Confirmed

Source:
SMART Health Link

\---

## Allergy

Penicillin

Reaction:
Rash

Source:
PDF Import

The user should never need to view raw FHIR resources.

\---

# Feature 8: Selective Sharing

The patient chooses what to share.

Example:

☑ Demographics

☑ Medications

☑ Allergies

☐ Labs

☐ Conditions

☐ Immunizations

Sharing must be patient controlled.

\---

# Feature 9: Export

Support:

## PDF Export

Human-readable summary.

Includes:

* Selected health information
* Source information
* PIQI summary

## SMART Health Link Export

Create an SHL package containing:

* Selected health information
* Provenance metadata
* Patient assertions

\---

# Important Rules

1. Source records are immutable.
2. Patient assertions never overwrite source records.
3. PIQI findings must be explainable.
4. Provenance must be preserved.
5. PIQI scores are data-quality scores, not health scores.
6. Clinical conclusions are outside MVP scope.
7. Provider review is outside MVP scope.
8. The application is a personal health data workspace, not an EHR.

\---

# Non-Goals

The MVP will NOT include:

* EHR integration
* Provider portal integration
* ID.me integration
* CLEAR integration
* Clinical decision support
* Treatment recommendations
* Risk prediction
* Direct EHR writeback
* CMS-Aligned Network participation
* Provider reconciliation workflows

\---

# Success Criteria

The MVP is successful when a user can:

1. Import a PDF or SMART Health Link.
2. View a unified health record.
3. Receive PIQI findings.
4. Review or ignore findings.
5. Add patient assertions.
6. Load a PIQI Gateway score for each data set.
7. Select information for sharing.
8. Export selected information as a PDF or SMART Health Link.

