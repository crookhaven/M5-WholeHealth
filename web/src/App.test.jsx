// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('starts on the Import tab', () => {
    render(<App />)
    expect(screen.getByRole('tab', { name: 'Import' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/no real data on hand yet/i)).toBeInTheDocument()
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'My health' }))
    expect(screen.getByRole('tab', { name: 'My health' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText(/no health information imported yet/i)).toBeInTheDocument()
  })

  it('loads the sample health record and shows it in My health', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Load sample health record' }))

    await user.click(screen.getByRole('tab', { name: 'My health' }))
    expect(screen.getByText('Atorvastatin')).toBeInTheDocument()
    expect(screen.getByText('Insulin pump')).toBeInTheDocument()
  })

  it('shows the same record in the provider-facing Clinical view, with codes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Load sample health record' }))
    await user.click(screen.getByRole('tab', { name: 'Clinical view' }))
    expect(screen.getByRole('tab', { name: 'Clinical view' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Atorvastatin').length).toBeGreaterThan(0)
  })

  it('has no Findings tab, and What to do waits for a PIQI result', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Load sample health record' }))
    expect(screen.queryByRole('tab', { name: /findings/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'My health' }))
    await user.click(screen.getByRole('tab', { name: 'What to do' }))
    expect(screen.getByText(/run your piqi score first/i)).toBeInTheDocument()
  })

  it('moves the selected patient up and down in the patient list', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Add patient' }))
    await user.type(screen.getByLabelText(/new patient name/i), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    // Only the patient list's options; the Import screen has other dropdowns.
    const order = () =>
      within(screen.getByRole('region', { name: 'Patient' }))
        .getAllByRole('option')
        .map((o) => o.textContent)
    expect(order()).toEqual(['Patient 1', 'Sam'])
    expect(screen.getByRole('button', { name: 'Move Sam down' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Move Sam up' }))
    expect(order()).toEqual(['Sam', 'Patient 1'])
    expect(screen.getByRole('button', { name: 'Move Sam up' })).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Patient' })).getByRole('combobox')).toHaveDisplayValue('Sam')
  })

  it('keeps each patient records separate', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Load sample health record' }))
    await user.click(screen.getByRole('button', { name: 'Add patient' }))
    await user.type(screen.getByLabelText(/new patient name/i), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('tab', { name: 'My health' }))
    expect(screen.getByText(/no health information imported yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Atorvastatin')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Family' }))
    expect(screen.getByRole('heading', { name: 'Sam' })).toBeInTheDocument()
  })

  it('encrypts the saved records with a passcode and asks for it on the next visit', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await user.type(screen.getByLabelText('Passcode'), 'correct horse')
    await user.type(screen.getByLabelText('Type it again'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Set passcode' }))
    await screen.findByRole('button', { name: 'Lock now' })
    await waitFor(() => expect(localStorage.getItem('m5-whole-health-workspace-v1')).toContain('m5vault'), { timeout: 10000 })
    expect(localStorage.getItem('m5-whole-health-workspace-v1')).not.toContain('Patient 1')
    unmount()

    render(<App />)
    expect(screen.queryByRole('tab', { name: 'Import' })).toBeNull()
    await user.type(screen.getByLabelText('Passcode'), 'wrong passcode')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('That passcode is not right.', {}, { timeout: 10000 })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Passcode'))
    await user.type(screen.getByLabelText('Passcode'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('tab', { name: 'Import' }, { timeout: 10000 })).toBeInTheDocument()
  }, 30000)
})
