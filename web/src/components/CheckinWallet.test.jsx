// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  // Click the step's main button until the last look ("Ready to send?").
  async function toLastLook(user) {
    for (let i = 0; i < 60 && !screen.queryByText('Ready to send?'); i++) {
      await user.click(screen.getByRole('button', { name: /^(Next|Looks right, next|Next: last look|Looks right, last look)$/ }))
    }
    expect(screen.getByText('Ready to send?')).toBeInTheDocument()
  }

  it('starts with who is asking and what for, then shares only what stays ticked', async () => {
    const reply = vi.fn()
    render(
      <WorkspaceProvider>
        <CheckinWallet />
      </WorkspaceProvider>,
    )
    act(() => setSessionForTests({ status: 'request', context: { request, origin: 'https://clinic.example', unsupportedItems: [] }, reply }))
    expect(await screen.findByText('A website wants you to check in')).toBeInTheDocument()
    expect(screen.getByText('clinic.example')).toBeInTheDocument()
    expect(screen.getByText(/Pre-visit check-in/)).toBeInTheDocument()
    expect(screen.getByText('This is a demo.')).toBeInTheDocument()
    expect(screen.queryByText(/wants you to check in/).textContent).not.toMatch(/clinic|provider|doctor/i)
    expect(screen.getByText('It asks for 2 things')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const allergies = screen.getByRole('checkbox', { name: 'Share Allergies' })
    expect(allergies).toBeChecked()
    await user.click(allergies)
    expect(screen.getByText('Not sharing this')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: last look' }))
    expect(screen.getByText('You chose not to share this.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send to clinic.example' }))
    const { response } = reply.mock.calls[0][0]
    expect(response.requestStatus).toEqual([
      { item: 'patient', status: 'fulfilled' },
      { item: 'allergies', status: 'declined' },
    ])
    expect(response.artifacts[0].value.entry[0].resource.id).toBe('p1')
  })

  it('will not send a form with no answers', async () => {
    const reply = vi.fn()
    render(
      <WorkspaceProvider>
        <CheckinWallet />
      </WorkspaceProvider>,
    )
    const form = {
      id: 'phq2',
      title: 'Mood',
      content: { kind: 'form.fhir', questionnaire: { resourceType: 'Questionnaire', url: 'https://e.org/q', item: [{ linkId: 'q1', type: 'choice', text: 'Little interest', answerOption: [{ valueCoding: { code: 'a', display: 'Not at all' } }] }] } },
      accept: ['application/fhir+json'],
    }
    act(() => setSessionForTests({ status: 'request', context: { request: { ...request, items: [form] }, origin: 'https://clinic.example', unsupportedItems: [] }, reply }))
    const user = userEvent.setup()
    expect(await screen.findByText('You answer these questions yourself.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: 'Next: last look' }))
    expect(screen.getByText('No answers yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to clinic.example' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Fix Mood' }))
    await user.click(screen.getByRole('radio', { name: 'Not at all' }))
    await user.click(screen.getByRole('button', { name: 'Next: last look' }))
    await user.click(screen.getByRole('button', { name: 'Send to clinic.example' }))
    expect(reply.mock.calls[0][0].response.artifacts[0].value.item[0].answer[0].valueCoding.code).toBe('a')
  })

  it('prefills the intake form, takes the patient through it part by part, and keeps shared records in step', async () => {
    const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
    const intake = read('../../public/questionnaires/patient-intake.json')
    const maximus = read('../../../synthetic-patients/maximus-decimus-meridius/maximus-decimus-meridius.json')
    const fhirResources = Object.fromEntries(maximus.entry.map((e) => [e.fullUrl, e.resource]))
    const slice = { sourceRecords: [], assertions: [], findingDecisions: {}, sharingSelection: {}, gatewayResults: {}, claimsData: null, fhirResources }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, patients: [{ id: 'x', name: 'Maximus' }], activeId: 'x', data: { x: slice }, activity: [] }))
    const reply = vi.fn()
    render(
      <WorkspaceProvider>
        <CheckinWallet />
      </WorkspaceProvider>,
    )
    const items = [
      { id: 'allergies', title: 'Allergies', content: { kind: 'selection.fhir', profiles: [`${US_CORE}us-core-allergyintolerance`] }, accept: ['application/fhir+json'] },
      { id: 'intake', title: 'Patient intake', content: { kind: 'form.fhir', questionnaire: intake }, accept: ['application/fhir+json'] },
    ]
    act(() => setSessionForTests({ status: 'request', context: { request: { ...request, items }, origin: 'https://clinic.example', unsupportedItems: [] }, reply }))
    const user = userEvent.setup()

    // The start screen lists the intake first, then the records it was filled from
    await screen.findByText('M5 fills in most of it from your records. You check each part.')
    expect([...document.querySelectorAll('.ck-plan strong')].map((e) => e.textContent)).toEqual(['Patient intake', 'Allergies'])
    await user.click(screen.getByRole('button', { name: 'Start' }))

    // One part at a time, filled in from the records
    expect(screen.getByText('Patient intake: part 1 of 17')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Demographics' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Maximus')).toBeInTheDocument()
    expect(screen.getByText('We filled this in from your details. Is it right? Fix anything that\'s wrong.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks right, next' }))
    await user.click(screen.getByRole('button', { name: 'Looks right, next' }))
    expect(screen.getByRole('heading', { name: 'Allergies' })).toBeInTheDocument()
    expect(screen.getAllByText('From your allergy list')).toHaveLength(4)

    // Remove one allergy and correct another
    await user.click(screen.getByRole('button', { name: 'Remove Allergies: penicillin G' }))
    expect(screen.getByText(/Removed:/)).toBeInTheDocument()
    const reaction = screen.getByDisplayValue('Angioedema')
    await user.clear(reaction)
    await user.type(reaction, 'Swollen lips')
    expect(screen.getByText('You changed this')).toBeInTheDocument()

    await toLastLook(user)
    expect(screen.getByText('Checked, you changed 1, you removed 1')).toBeInTheDocument()
    expect(screen.getByText('3 of 4 records')).toBeInTheDocument()

    // The allergy removed in the form is unticked in the records, with a note
    await user.click(screen.getByRole('button', { name: 'Change Allergies' }))
    expect(screen.getByText('These also filled in the Allergies part of your "Patient intake" form.')).toBeInTheDocument()
    expect(screen.getByText('You removed this in your "Patient intake" form, so it\'s unticked.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: last look' }))
    await user.click(screen.getByRole('button', { name: 'Send to clinic.example' }))

    const { response } = reply.mock.calls[0][0]
    expect(response.requestStatus).toEqual([
      { item: 'allergies', status: 'partial', message: 'The patient chose to share 3 of 4 records.' },
      { item: 'intake', status: 'fulfilled' },
    ])
    const qr = response.artifacts.find((a) => a.fulfills.includes('intake')).value
    expect(qr.questionnaire).toBe(`${intake.url}|${intake.version}`)
    const allergies = qr.item.filter((i) => i.linkId === 'allergies')
    expect(allergies.map((g) => g.item[0].answer[0].valueCoding.display)).toEqual(['lisinopril', 'Seafood', 'Latex'])
    expect(allergies[0].item.find((i) => i.linkId === 'allergy-reaction').answer).toEqual([{ valueString: 'Swollen lips' }])
  }, 30000)
})
