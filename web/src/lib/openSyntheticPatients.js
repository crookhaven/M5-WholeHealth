import { normalizeFhirBundle } from './fhir/normalize'
import { extractClaims } from './claims/extract'
import { createSourceRecord } from './sourceRecord'

// The open-synthetic-patients collection on GitHub. raw.githubusercontent.com
// allows cross-origin reads, so the app can load straight from it.
export const OSP_REPO = 'https://github.com/crookhaven/open-synthetic-patients'
const RAW = 'https://raw.githubusercontent.com/crookhaven/open-synthetic-patients/main'
export const CATALOG_URL = `${RAW}/catalog.json`
// The test patient offered to check-in testers: every US Core item a check-in
// page asks for in the connectathon's minimum scenarios.
export const CHECKIN_TEST_PATIENT = { name: 'Maximus Decimus Meridius', url: `${RAW}/patients/maximus-decimus-meridius/bundle.json` }
export const MARKETPLACE_PLANS_URL = `${RAW}/marketplace/marketplace_plans_48201.json`

export function catalogPatients(catalog) {
  if (!Array.isArray(catalog?.patients)) throw new Error('The open-synthetic-patients catalog is not in the expected format.')
  return catalog.patients
    .filter((p) => p.path && p.variants?.clean)
    .map((p) => ({
      slug: p.slug,
      name: p.name ?? p.slug,
      summary: p.summary ?? '',
      useCases: p.use_cases ?? [],
      license: p.license ?? '',
      url: `${RAW}/${p.path}/${p.variants.clean}`,
    }))
}

export async function fetchFromGitHub(url, as = 'json', fetchImpl = globalThis.fetch) {
  let res
  try {
    res = await fetchImpl(url)
  } catch {
    throw new Error('Could not reach GitHub. Check your connection and try again.')
  }
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${url.split('/').slice(-2).join('/')}.`)
  return as === 'text' ? res.text() : res.json()
}

// A FHIR Bundle as the app's source records plus any insurance claims.
export function bundleToRecords(bundle, { sourceType, documentName }) {
  const normalized = normalizeFhirBundle(bundle)
  if (normalized.length === 0) {
    throw new Error('No recognized FHIR resources found. This importer expects a single Bundle (not a bulk-export NDJSON file).')
  }
  const records = normalized.map(({ domain, data }) => createSourceRecord({ sourceType, documentName, domain, data }))
  return { records, claimsData: extractClaims(bundle), bundle }
}
