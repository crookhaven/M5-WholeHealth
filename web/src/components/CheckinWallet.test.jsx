// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspaceProvider } from '../state/WorkspaceContext'
import { STORAGE_KEY } from '../state/workspaceState'
import { setSessionForTests } from '../lib/checkin/session'
import CheckinWallet from './CheckinWallet'

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition/'

function seed() {
  const slice = {
    sourceRecords: [],
    assertions: [],
    findingDecisions: {},
    sharingSelection: {},
    gatewayResults: {},
    claimsData: null,
    fhirResources: {
      'urn:uuid:p1': { resourceType: 'Patient', id: 'p1', meta: { profile: [`${US_CORE}us-core-patient`] }, name: [{ given: ['Max'], family: 'Test' }] },
      'urn:uuid:a1': { resourceType: 'AllergyIntolerance', id: 'a1', meta: { profile: [`${US_CORE}us-core-allergyintolerance`] }, code: { text: 'Peanut' } },
    },
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, patients: [{ id: 'x', name: 'Max Test' }], activeId: 'x', data: { x: slice }, activity: [] }))
}

const request = {
  type: 'smart-health-checkin-request',
  version: '1',
  id: 'r1',
  purpose: 'Pre-visit check-in',
  items: [
    { id: 'patient', title: 'Demographics', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-patient`] }, accept: ['application/fhir+json'] },
    { id: 'allergies', title: 'Allergies', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-allergyintolerance`] }, accept: ['application/fhir+json'] },
  ],
}

describe('CheckinWallet', () => {
  beforeEach(() => {
    localStorage.clear()
    seed()
  })

  it('shows who is asking, and shares only what stays ticked', async () => {
    const reply = vi.fn()
    render(
      <WorkspaceProvider>
        <CheckinWallet />
      </WorkspaceProvider>,
    )
    act(() => setSessionForTests({ status: 'request', context: { request, origin: 'https://clinic.example', unsupportedItems: [] }, reply }))
    expect(screen.getByText('https://clinic.example')).toBeInTheDocument()
    const user = userEvent.setup()
    const allergies = await screen.findByRole('checkbox', { name: /Allergies/ })
    expect(allergies).toBeChecked()
    await user.click(allergies)
    await user.click(screen.getByRole('button', { name: "Share what's ticked" }))
    const { response } = reply.mock.calls[0][0]
    expect(response.requestStatus).toEqual([
      { item: 'patient', status: 'fulfilled' },
      { item: 'allergies', status: 'declined' },
    ])
    expect(response.artifacts[0].value.entry[0].resource.id).toBe('p1')
  })
})
