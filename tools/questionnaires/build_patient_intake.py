"""Build M5 Whole Health's patient intake Questionnaire from Medplum's.

Usage (from the repo root):
  python3 tools/questionnaires/build_patient_intake.py \
    tools/questionnaires/source/medplum-patient-intake-questionnaire.json \
    web/public/questionnaires/patient-intake.json

Starts from Medplum's patient-intake Questionnaire (Apache-2.0) and applies
M5's changes, so every difference from the original is visible here.
"""
import copy
import json
import sys

CANONICAL = "https://crookhaven.github.io/M5-WholeHealth/questionnaires/patient-intake.json"
VERSION = "0.1.0"
PRACTICE = "[Practice Name]"

SDC = "http://hl7.org/fhir/uv/sdc/StructureDefinition/"
FP = "text/fhirpath"
QUERY = "application/x-fhir-query"

SNOMED = "http://snomed.info/sct"
NULL = "http://terminology.hl7.org/CodeSystem/v3-NullFlavor"
DAR = "http://terminology.hl7.org/CodeSystem/data-absent-reason"
OMB = "urn:oid:2.16.840.1.113883.6.238"  # CDC Race & Ethnicity, as US Core uses it
BCP47 = "urn:ietf:bcp:47"
ROLE = "http://terminology.hl7.org/CodeSystem/v3-RoleCode"


def coding(system, code, display):
    return {"valueCoding": {"system": system, "code": code, "display": display}}


def opts(*codings):
    return [coding(*c) for c in codings]


ASKED_UNKNOWN = [(NULL, "ASKU", "Asked but unknown"), (NULL, "UNK", "Unknown")]

LISTS = {
    "state": [{"valueString": s} for s in (
        "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY "
        "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI"
    ).split()],
    "race": opts(
        (OMB, "1002-5", "American Indian or Alaska Native"),
        (OMB, "2028-9", "Asian"),
        (OMB, "2054-5", "Black or African American"),
        (OMB, "2076-8", "Native Hawaiian or Other Pacific Islander"),
        (OMB, "2106-3", "White"),
        *ASKED_UNKNOWN,
    ),
    "ethnicity": opts(
        (OMB, "2135-2", "Hispanic or Latino"),
        (OMB, "2186-5", "Not Hispanic or Latino"),
        *ASKED_UNKNOWN,
    ),
    # Same codes as HL7's http://terminology.hl7.org/ValueSet/gender-identity
    "gender-identity": opts(
        (SNOMED, "446141000124107", "Female gender identity"),
        (SNOMED, "446151000124109", "Male gender identity"),
        (SNOMED, "33791000087105", "Non-binary gender identity"),
        (NULL, "OTH", "Other"),
        (DAR, "asked-declined", "Prefer not to say"),
        (NULL, "UNK", "Unknown"),
    ),
    "related-person-gender-identity": None,  # filled from gender-identity below
    "sexual-orientation": opts(
        (SNOMED, "20430005", "Heterosexual"),
        (SNOMED, "38628009", "Homosexual"),
        (SNOMED, "42035005", "Bisexual"),
        (NULL, "OTH", "Other"),
        (NULL, "ASKU", "Prefer not to say"),
        (NULL, "UNK", "Unknown"),
    ),
    "medical-history-clinical-status": opts(
        ("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active"),
        ("http://terminology.hl7.org/CodeSystem/condition-clinical", "recurrence", "Recurrence"),
        ("http://terminology.hl7.org/CodeSystem/condition-clinical", "relapse", "Relapse"),
        ("http://terminology.hl7.org/CodeSystem/condition-clinical", "inactive", "Inactive"),
        ("http://terminology.hl7.org/CodeSystem/condition-clinical", "remission", "Remission"),
        ("http://terminology.hl7.org/CodeSystem/condition-clinical", "resolved", "Resolved"),
    ),
    "family-member-history-relationship": opts(
        (ROLE, "MTH", "Mother"), (ROLE, "FTH", "Father"), (ROLE, "PRN", "Parent"),
        (ROLE, "SIS", "Sister"), (ROLE, "BRO", "Brother"), (ROLE, "SIB", "Sibling"),
        (ROLE, "DAU", "Daughter"), (ROLE, "SON", "Son"), (ROLE, "CHILD", "Child"),
        (ROLE, "GRMTH", "Grandmother"), (ROLE, "GRFTH", "Grandfather"),
        (ROLE, "AUNT", "Aunt"), (ROLE, "UNCLE", "Uncle"), (ROLE, "COUSN", "Cousin"),
        (ROLE, "FAMMEMB", "Other family member"),
    ),
    "relationship-to-subscriber": opts(*[
        ("http://terminology.hl7.org/CodeSystem/subscriber-relationship", c, d) for c, d in (
            ("self", "Self"), ("spouse", "Spouse"), ("common", "Common Law Spouse"), ("child", "Child"),
            ("parent", "Parent"), ("injured", "Injured Party"), ("other", "Other"))
    ]),
    "housing-status": opts(*[
        ("http://terminology.hl7.org/CodeSystem/v3-LivingArrangement", c, d) for c, d in (
            ("H", "Independent household"), ("R", "Retirement community"), ("SL", "Supported living"),
            ("G", "Group home"), ("N", "Nursing home"), ("X", "Extended care facility"),
            ("CS", "Community shelter"), ("T", "Transient"), ("HL", "Homeless"))
    ]),
    "education-level": opts(*[
        ("http://terminology.hl7.org/CodeSystem/v3-EducationLevel", c, d) for c, d in (
            ("ELEM", "Elementary school"), ("SEC", "Some secondary or high school"),
            ("HS", "High school or secondary school degree"), ("SCOL", "Some college"),
            ("ASSOC", "Associate's or technical degree"), ("BD", "College or baccalaureate degree"),
            ("PB", "Some post-baccalaureate education"), ("GD", "Graduate or professional degree"),
            ("POSTG", "Doctoral or post graduate education"))
    ]),
    "smoking-status": opts(
        (SNOMED, "449868002", "Smokes tobacco daily"),
        (SNOMED, "428041000124106", "Occasional tobacco smoker"),
        (SNOMED, "77176002", "Smoker"),
        (SNOMED, "8517006", "Ex-smoker"),
        (SNOMED, "266919005", "Never smoked tobacco"),
        (SNOMED, "266927001", "Tobacco smoking consumption unknown"),
    ),
    # Replaces http://example.com/pregnancy-status. 77386006 is the code the
    # estimated-delivery-date enableWhen already used.
    "pregnancy-status": opts(
        (SNOMED, "77386006", "Pregnant"),
        (SNOMED, "60001007", "Not pregnant"),
        (SNOMED, "261665006", "Unknown"),
    ),
    "_languages": opts(*[(BCP47, c, d) for c, d in (
        ("en", "English"), ("es", "Spanish"), ("zh", "Chinese"), ("vi", "Vietnamese"), ("tl", "Tagalog"),
        ("ar", "Arabic"), ("fr", "French"), ("ht", "Haitian Creole"), ("ko", "Korean"), ("ru", "Russian"),
        ("pt", "Portuguese"), ("de", "German"), ("hi", "Hindi"), ("pl", "Polish"), ("it", "Italian"),
        ("ja", "Japanese"), ("fa", "Persian"), ("ur", "Urdu"), ("bn", "Bengali"), ("so", "Somali"),
        ("uk", "Ukrainian"), ("sgn", "Sign language"))]),
}
LISTS["related-person-gender-identity"] = LISTS["gender-identity"]
LISTS["languages-spoken"] = LISTS["preferred-language"] = LISTS.pop("_languages")

# Coded answers that come from the patient's own records. No fixed list (the
# original pointed at VSAC value sets); open-choice lets the record's code
# through and lets the patient type anything new.
OPEN_FROM_RECORDS = {
    "allergy-substance", "medication-code", "medical-history-problem",
    "family-member-history-problem", "immunization-vaccine",
}
# The two language questions also take a record's code (e.g. en-US) that isn't
# on the short list.
OPEN_WITH_LIST = {"languages-spoken", "preferred-language"}

DATETIME_TO_DATE = {"allergy-onset", "medical-history-onset", "immunization-date"}
REFERENCE_TO_STRING = {
    "preferred-pharmacy-reference": "Pharmacy name and location",
    "insurance-provider": "Insurance company",
}
MAKE_OPTIONAL = {"ssn", "gender-identity"}
MAKE_REPEATING = {"race"}  # US Core allows more than one OMB race category


def x(url, **value):
    return {"url": url, **value}


def expr(expression, name=None, language=FP):
    e = {"language": language, "expression": expression}
    if name:
        e = {"name": name, **e}
    return e


def init(expression):
    return x(SDC + "sdc-questionnaire-initialExpression", valueExpression=expr(expression))


def context(name, expression):
    return x(SDC + "sdc-questionnaire-itemPopulationContext", valueExpression=expr(expression, name))


def variable(name, query):
    return x("http://hl7.org/fhir/StructureDefinition/variable", valueExpression=expr(query, name, QUERY))


US_CORE = "http://hl7.org/fhir/us/core/StructureDefinition/"
LATEST_OBS = "Observation?patient={{%patient.id}}&code=http://loinc.org|{code}&_sort=-date&_count=1"
VARIABLES = [
    ("relatedPersons", "RelatedPerson?patient={{%patient.id}}"),
    ("allergies", "AllergyIntolerance?patient={{%patient.id}}&clinical-status=active"),
    ("medicationRequests", "MedicationRequest?patient={{%patient.id}}&status=active"),
    ("medicationStatements", "MedicationStatement?patient={{%patient.id}}&status=active"),
    ("conditions", "Condition?patient={{%patient.id}}&category=problem-list-item"),
    ("familyHistory", "FamilyMemberHistory?patient={{%patient.id}}"),
    ("immunizations", "Immunization?patient={{%patient.id}}&status=completed"),
    ("coverages", "Coverage?patient={{%patient.id}}&status=active&_include=Coverage:payor"),
    ("smoking", LATEST_OBS.replace("{code}", "72166-2")),
    ("pregnancy", LATEST_OBS.replace("{code}", "82810-3")),
    ("sexualOrientation", LATEST_OBS.replace("{code}", "76690-7")),
]

HOME = "%patient.address.where(use = 'home' or use.empty()).first()"
PHONE = "%patient.telecom.where(system = 'phone')"
IS_EMERGENCY = "relationship.coding.where(system = 'http://terminology.hl7.org/CodeSystem/v2-0131' and code = 'C').exists()"

CONTEXTS = {
    "emergency-contact": ("contact", f"%patient.contact.where({IS_EMERGENCY}) | "
                                     f"%relatedPersons.entry.resource.ofType(RelatedPerson).where({IS_EMERGENCY})"),
    "allergies": ("allergy", "%allergies.entry.resource.ofType(AllergyIntolerance)"),
    "medications": ("medication", "%medicationRequests.entry.resource.ofType(MedicationRequest) | "
                                  "%medicationStatements.entry.resource.ofType(MedicationStatement)"),
    "medical-history": ("condition", "%conditions.entry.resource.ofType(Condition)"),
    "family-member-history": ("relative", "%familyHistory.entry.resource.ofType(FamilyMemberHistory)"),
    "vaccination-history": ("immunization", "%immunizations.entry.resource.ofType(Immunization)"),
    "coverage-information": ("coverage", "%coverages.entry.resource.ofType(Coverage)"),
}

INITIAL = {
    # Demographics
    "first-name": "%patient.name.where(use = 'official' or use.empty()).first().given.first()",
    "middle-name": "%patient.name.where(use = 'official' or use.empty()).first().given.skip(1).first()",
    "last-name": "%patient.name.where(use = 'official' or use.empty()).first().family",
    "dob": "%patient.birthDate",
    "street": f"{HOME}.line.join(', ')",
    "city": f"{HOME}.city",
    "state": f"{HOME}.state",
    "zip": f"{HOME}.postalCode",
    "phone": f"({PHONE}.where(use = 'home') | {PHONE}.where(use != 'home')).first().value",
    "phone-sms": f"{PHONE}.where(use = 'mobile').first().value",
    "email": "%patient.telecom.where(system = 'email').first().value",
    # ssn: never prefilled, even if the record has one
    "race": f"%patient.extension.where(url = '{US_CORE}us-core-race').extension.where(url = 'ombCategory').value",
    "ethnicity": f"%patient.extension.where(url = '{US_CORE}us-core-ethnicity').extension.where(url = 'ombCategory').value.first()",
    "gender-identity": (
        f"(%patient.extension.where(url = '{US_CORE}us-core-genderIdentity').value.coding"
        " | %patient.extension.where(url = 'http://hl7.org/fhir/StructureDefinition/individual-genderIdentity')"
        ".extension.where(url = 'value').value.coding).first()"),
    "sexual-orientation": "%sexualOrientation.entry.resource.ofType(Observation).value.coding.first()",
    # Emergency contact (Patient.contact or RelatedPerson marked as emergency contact)
    "emergency-contact-first-name": "%contact.name.first().given.first()",
    "emergency-contact-middle-name": "%contact.name.first().given.skip(1).first()",
    "emergency-contact-last-name": "%contact.name.first().family",
    "emergency-contact-phone": "%contact.telecom.where(system = 'phone').first().value",
    # Clinical lists
    "allergy-substance": "%allergy.code.coding.first()",
    "allergy-reaction": "%allergy.reaction.manifestation.coding.display.distinct().join(', ')",
    "allergy-onset": "%allergy.onset.ofType(dateTime).toString().substring(0, 10).toDate()",
    "medication-code": "%medication.medication.ofType(CodeableConcept).coding.first()",
    "medication-note": "%medication.dosageInstruction.text.first() | %medication.dosage.text.first()",
    "medical-history-problem": "%condition.code.coding.first()",
    "medical-history-clinical-status": "%condition.clinicalStatus.coding.first()",
    "medical-history-onset": "%condition.onset.ofType(dateTime).toString().substring(0, 10).toDate()",
    "family-member-history-problem": "%relative.condition.code.coding.first()",
    "family-member-history-relationship": "%relative.relationship.coding.first()",
    "family-member-history-deceased": "%relative.deceased.ofType(boolean)",
    "immunization-vaccine": "%immunization.vaccineCode.coding.first()",
    "immunization-date": "%immunization.occurrence.ofType(dateTime).toString().substring(0, 10).toDate()",
    # Coverage
    "insurance-provider": (
        "(%coverage.payor.display | %coverages.entry.resource.ofType(Organization)"
        ".where(('Organization/' + id) in %coverage.payor.reference).name).first()"),
    "subscriber-id": "%coverage.subscriberId",
    "relationship-to-subscriber": "%coverage.relationship.coding.first()",
    # Social history
    "smoking-status": "%smoking.entry.resource.ofType(Observation).value.coding.first()",
    "pregnancy-status": "%pregnancy.entry.resource.ofType(Observation).value.coding.first()",
    # Language
    "languages-spoken": "%patient.communication.language.coding",
    "preferred-language": "%patient.communication.where(preferred = true).language.coding.first()",
}


def transform(item, seen):
    item = copy.deepcopy(item)
    lid = item["linkId"]
    seen.add(lid)
    if lid in MAKE_OPTIONAL:
        item.pop("required", None)
    if lid in MAKE_REPEATING:
        item["repeats"] = True
    if lid in DATETIME_TO_DATE:
        item["type"] = "date"
    if lid in REFERENCE_TO_STRING:
        item["type"] = "string"
        item["text"] = REFERENCE_TO_STRING[lid]
        item["extension"] = [e for e in item.get("extension", []) if not e["url"].endswith("questionnaire-referenceResource")]
    if lid in OPEN_FROM_RECORDS:
        item["type"] = "open-choice"
        item.pop("answerValueSet", None)
    elif lid in LISTS:
        item.pop("answerValueSet", None)
        item["answerOption"] = LISTS[lid]
        if lid in OPEN_WITH_LIST:
            item["type"] = "open-choice"
    if "answerValueSet" in item:
        raise SystemExit(f"{lid} still points at a value set")
    ext = item.get("extension", [])
    if lid in CONTEXTS:
        ext.append(context(*CONTEXTS[lid]))
    if lid in INITIAL:
        ext.append(init(INITIAL[lid]))
    if ext:
        item["extension"] = ext
    elif "extension" in item:
        del item["extension"]
    for key in ("text",):
        if key in item and "Sample Hospital" in item[key]:
            item[key] = item[key].replace("Sample Hospital", PRACTICE)
    if "item" in item:
        item["item"] = [transform(i, seen) for i in item["item"]]
    return item


def main(src, out):
    bundle = json.load(open(src))
    original = next(e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Questionnaire")
    seen = set()
    items = [transform(i, seen) for i in original["item"]]
    for keys in (INITIAL, CONTEXTS, LISTS, MAKE_OPTIONAL, DATETIME_TO_DATE, REFERENCE_TO_STRING, OPEN_FROM_RECORDS):
        missing = set(keys) - seen
        if missing:
            raise SystemExit(f"unknown linkIds: {sorted(missing)}")
    q = {
        "resourceType": "Questionnaire",
        "id": "m5-patient-intake",
        "meta": {"profile": [
            "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-pop-exp",
        ]},
        "extension": [
            x(SDC + "sdc-questionnaire-launchContext", extension=[
                x("name", valueCoding={"system": "http://hl7.org/fhir/uv/sdc/CodeSystem/launchContext", "code": "patient"}),
                x("type", valueCode="Patient"),
                x("description", valueString="The patient filling in the form"),
            ]),
            *[variable(n, q) for n, q in VARIABLES],
        ],
        "url": CANONICAL,
        "version": VERSION,
        "name": "M5PatientIntake",
        "title": "Patient Intake Questionnaire",
        "status": "active",
        "experimental": True,
        "subjectType": ["Patient"],
        "publisher": "M5 Whole Health",
        "description": (
            "Patient intake form for SMART Health Check-in testing. Adapted from Medplum's patient intake "
            "questionnaire (https://github.com/medplum/medplum-patient-intake-demo, Apache License 2.0), with "
            "SDC expression-based population so a wallet can prefill it from the patient's own FHIR records, "
            "inline answer lists in place of value sets that need a terminology server, and SSN and gender "
            "identity made optional. A practice adopting it replaces \"" + PRACTICE + "\" with its own name."
        ),
        "copyright": "Portions derived from the Medplum patient intake demo, licensed under the Apache License 2.0.",
        "derivedFrom": [original["url"]],
        "item": items,
    }
    json.dump(q, open(out, "w"), indent=2, ensure_ascii=False)
    open(out, "a").write("\n")


if __name__ == "__main__":
    main(*sys.argv[1:])
