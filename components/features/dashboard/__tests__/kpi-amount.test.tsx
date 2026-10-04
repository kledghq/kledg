import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { KpiAmount, KpiCents } from '../kpi-amount'

describe('KpiAmount', () => {
  it('shows the full amount below ten million euros', () => {
    render(<KpiAmount value={9_999_999.99} />)
    expect(screen.getByText(/9\s999\s999,99\s€/)).toBeInTheDocument()
  })

  it('shows a compact amount above, with the full amount for screen readers and on hover', () => {
    const { container } = render(<KpiAmount value={-12_345_678.9} />)
    const shown = container.querySelector('[aria-hidden]')!
    expect(shown.textContent).toMatch(/-12,3\sM\s?€/)
    expect(screen.getByText(/-12\s345\s678,90\s€/)).toHaveClass('sr-only')
    expect(container.firstElementChild).toHaveAttribute('title', expect.stringMatching(/12\s345\s678,90/))
  })

  it('reads integer cents exactly', () => {
    render(<KpiCents cents={-135_026} />)
    expect(screen.getByText(/-1\s350,26\s€/)).toBeInTheDocument()
  })
})
