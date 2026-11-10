// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
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
    await user.click(await screen.findByRole('button', { name: "Share what's ticked" }))
    expect(reply).not.toHaveBeenCalled()
    expect(screen.getByText(/Answer the questions in "Mood"/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Not at all' }))
    await user.click(screen.getByRole('button', { name: "Share what's ticked" }))
    expect(reply.mock.calls[0][0].response.artifacts[0].value.item[0].answer[0].valueCoding.code).toBe('a')
  })

  it('prefills the intake form, makes the patient check it, and keeps shared records in step', async () => {
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

    // Filled in from the records, each entry saying where it came from
    expect(await screen.findByText(/M5 filled in what it could from your records/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Maximus')).toBeInTheDocument()
    expect(screen.getByDisplayValue('penicillin G')).toBeInTheDocument()
    expect(screen.getAllByText('From your allergy list')).toHaveLength(4)
    // The intake comes first, then the records it was filled in from
    const headings = screen.getAllByRole('checkbox', { name: /^(Allergies|Patient intake)$/ }).map((c) => c.getAttribute('aria-label') ?? c.closest('label').textContent)
    expect(headings[0]).toMatch(/Patient intake/)
    expect(screen.getByText('These records filled in the Allergies section of "Patient intake" above.')).toBeInTheDocument()

    // Not sent until it's checked
    await user.click(screen.getByRole('button', { name: "Share what's ticked" }))
    expect(reply).not.toHaveBeenCalled()
    expect(screen.getByText(/Check what M5 filled in from your records in "Patient intake"/)).toBeInTheDocument()

    // Removing an allergy in the form unticks that record in the Allergies item
    await user.click(screen.getByRole('button', { name: 'Remove Allergies: penicillin G' }))
    expect(screen.getByText(/You changed or removed 1 of these in a form/)).toBeInTheDocument()
    expect(screen.getByText(/1 of these in a form/).closest('section')).toHaveTextContent('3 of 4 records ticked')

    // Correct a reaction, then check everything
    const reaction = screen.getByDisplayValue('Angioedema')
    await user.clear(reaction)
    await user.type(reaction, 'Swollen lips')
    // Whole lists first, then the sections and single entries left
    for (const name of [/^All \d+ below are right$/, / is right$/]) {
      for (;;) {
        const buttons = screen.queryAllByRole('button', { name })
        if (!buttons.length) break
        await user.click(buttons[0])
      }
    }
    expect(screen.getByText('Everything M5 filled in has been checked.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: "Share what's ticked" }))

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
    expect(within(document.body).queryByText(/penicillin G/)).toBeInTheDocument() // still shown, struck through, so it can be undone
    // A big real-world form with many clicks: give slower CI runners room.
  }, 30000)
})

