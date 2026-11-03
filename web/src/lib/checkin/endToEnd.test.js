// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { runCheckin } from '@smart-health-checkin/client'
import { mockWallet } from '@smart-health-checkin/client/testing'
import { buildResponse, prepareItems, walletEntries } from './respond'
import { mergeFhirResources } from '../../state/workspaceState'

// The whole round trip with the library's own Verifier: M5's response is
// signed, encrypted, decrypted and checked exactly as a check-in page would.
const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition/'
const fhir = mergeFhirResources({}, [
  {
    resourceType: 'Bundle',
    entry: [
      { fullUrl: 'urn:uuid:p1', resource: { resourceType: 'Patient', id: 'p1', meta: { profile: [`${US_CORE}us-core-patient|6.1.0`] } } },
      {
        fullUrl: 'urn:uuid:c1',
        resource: {
          resourceType: 'Coverage',
          id: 'c1',
          meta: { profile: [`${US_CORE}us-core-coverage|6.1.0`] },
          status: 'active',
          beneficiary: { reference: 'urn:uuid:p1' },
          payor: [{ display: 'Test Health Plan' }],
        },
      },
    ],
  },
])

describe('M5 as a check-in wallet, end to end', () => {
  it('sends a response a check-in page accepts', async () => {
    const items = [
      { id: 'patient', title: 'Demographics', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-patient`] }, accept: ['application/fhir+json'] },
      {
        id: 'coverage',
        title: 'Insurance card',
        content: { kind: 'selection.fhir', profiles: ['http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage', `${US_CORE}us-core-coverage`] },
        accept: ['application/smart-health-card', 'application/fhir+json'],
      },
    ]
    const entries = walletEntries(fhir)
    // prepareItems has no async work for selection items; resolve it first.
    const prepared = await prepareItems({ request: { items }, entries })
    const realWallet = mockWallet({
      respond: (request) => buildResponse({ request, prepared, choices: { patient: true, coverage: true }, answers: {}, patientRef: 'urn:uuid:p1' }),
    })
    const result = await runCheckin({ purpose: 'Test check-in', items }, { wallet: realWallet })
    expect(result.status).toBe('completed')
    expect(result.warnings).toEqual([])
    const coverage = result.response.resources('coverage')
    expect(coverage.map((r) => r.resourceType)).toContain('Coverage')
  })
})
