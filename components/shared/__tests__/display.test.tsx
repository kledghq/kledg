import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Amount, formatAmount, formatPercent } from '../amount'
import { DateDisplay, formatDisplayDate } from '../date-display'
import { StatusBadge } from '../status-badge'

// Intl uses a narrow no-break space (U+202F) as the French thousands separator
// and a no-break space (U+00A0) before the euro sign. Normalize for readability.
const plain = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')

describe('formatAmount', () => {
  it('formats euros the French way', () => {
    expect(plain(formatAmount(1234.56))).toBe('1 234,56 €')
    expect(plain(formatAmount('98765.4'))).toBe('98 765,40 €')
  })

  it('formats without currency or with another precision', () => {
    expect(plain(formatAmount(1234.5, { currency: false }))).toBe('1 234,50')
    expect(plain(formatAmount(1234.5, { decimals: 0 }))).toBe('1 235 €')
  })

  it('signs positive values on request and never shows a negative zero', () => {
    expect(plain(formatAmount(12, { sign: 'always' }))).toBe('+12,00 €')
    expect(plain(formatAmount(-12))).toBe('-12,00 €')
    expect(plain(formatAmount(-0.001))).toBe('0,00 €')
  })

  it('returns an empty string for missing or invalid values', () => {
    expect(formatAmount(null)).toBe('')
    expect(formatAmount(undefined)).toBe('')
    expect(formatAmount('')).toBe('')
    expect(formatAmount('abc')).toBe('')
  })
})

describe('formatPercent', () => {
  it('formats percentages the French way, with a no-break space before %', () => {
    expect(plain(formatPercent(100))).toBe('100 %')
    expect(plain(formatPercent('33.33'))).toBe('33,33 %')
    expect(plain(formatPercent(12.5))).toBe('12,5 %')
    expect(formatPercent(50)).toMatch(/^50[  ]%$/)
    expect(formatPercent(null)).toBe('')
  })
})

describe('Amount', () => {
  it('renders tabular figures that never wrap', () => {
    render(<Amount value={1500} />)
    const el = screen.getByText((_, node) => plain(node?.textContent ?? null) === '1 500,00 €' && node?.tagName === 'SPAN')
    expect(el).toHaveClass('num', 'whitespace-nowrap')
    expect(el).not.toHaveClass('text-success')
  })

  it('colors signed amounts only when asked', () => {
    const { rerender, container } = render(<Amount value={-5} tone="signed" />)
    expect(container.firstChild).toHaveClass('text-destructive')
    rerender(<Amount value={5} tone="signed" />)
    expect(container.firstChild).toHaveClass('text-success')
  })

  it('shows a readable placeholder for missing values', () => {
    render(<Amount value={null} />)
    expect(screen.getByText('Non renseigné')).toHaveClass('text-muted-foreground')
  })
})

describe('formatDisplayDate', () => {
  const day = '2026-01-01T00:00:00.000Z'

  it('formats accounting days in UTC so they never shift by one day', () => {
    expect(formatDisplayDate(day)).toBe('01/01/2026')
    expect(formatDisplayDate(new Date(day), 'long')).toBe('1 janvier 2026')
    expect(formatDisplayDate(day, 'month')).toBe('janv. 2026')
  })

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatDisplayDate(null)).toBe('')
    expect(formatDisplayDate('not a date')).toBe('')
  })
})

describe('DateDisplay', () => {
  it('renders a time element with the ISO day', () => {
    render(<DateDisplay value="2026-03-31T00:00:00.000Z" />)
    const time = screen.getByText('31/03/2026')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2026-03-31')
  })

  it('shows a placeholder when the date is missing', () => {
    render(<DateDisplay value={null} empty="Jamais" />)
    expect(screen.getByText('Jamais')).toBeInTheDocument()
  })
})

describe('StatusBadge', () => {
  it('carries the meaning in its label and the tone in a data attribute', () => {
    render(<StatusBadge tone="success">Ouvert</StatusBadge>)
    const badge = screen.getByText('Ouvert')
    expect(badge).toHaveAttribute('data-tone', 'success')
    // The colored dot is decorative.
    expect(badge.querySelector('[aria-hidden]')).toHaveClass('bg-success')
  })
})
