// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConnectathonPanel from './ConnectathonPanel'

describe('ConnectathonPanel', () => {
  it('links to the demo clinic', () => {
    render(<ConnectathonPanel />)
    expect(screen.getByRole('link', { name: 'Open the demo clinic' })).toHaveAttribute('href', '/clinic/')
  })
})
