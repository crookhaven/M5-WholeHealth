// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import PolicyNotice, { POLICY_VERSION } from './PolicyNotice'

describe('PolicyNotice', () => {
  beforeEach(() => localStorage.clear())

  it('asks first-time users to agree, then stays hidden', async () => {
    const { unmount } = render(<PolicyNotice />)
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', 'privacy.html')
    await userEvent.setup().click(screen.getByRole('button', { name: 'I agree' }))
    expect(screen.queryByRole('region', { name: 'Terms and privacy' })).toBeNull()
    unmount()
    render(<PolicyNotice />)
    expect(screen.queryByRole('region', { name: 'Terms and privacy' })).toBeNull()
  })

  it('shows again when the policy has changed since it was accepted', () => {
    localStorage.setItem('m5-policy-seen', '2020-01-01')
    render(<PolicyNotice />)
    expect(screen.getByText(new RegExp(`changed on ${POLICY_VERSION}`))).toBeTruthy()
    expect(screen.getByRole('button', { name: 'I have read the changes' })).toBeTruthy()
  })
})
