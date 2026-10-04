import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FixedAssetsStats, netBookValue } from '../fixed-assets-stats'

describe('netBookValue', () => {
  it('subtracts the depreciation in cents', () => {
    expect(netBookValue({ totalAssets: 0.3, previousDepreciation: 0.1, currentDepreciation: 0.2 })).toBe(0)
    expect(netBookValue({ totalAssets: 12000, previousDepreciation: 2400.33, currentDepreciation: 2400.33 })).toBe(7199.34)
  })

  it('never goes below zero', () => {
    expect(netBookValue({ totalAssets: 100, previousDepreciation: 80, currentDepreciation: 40 })).toBe(0)
  })
})

describe('FixedAssetsStats', () => {
  it('shows four neutral figures', () => {
    const { container } = render(
      <FixedAssetsStats totalAssets={12000} previousDepreciation={2400} currentDepreciation={2400} />,
    )
    expect(container.querySelectorAll('[data-slot="stat-card"]')).toHaveLength(4)
    expect(screen.getByText('Valeur nette comptable')).toBeInTheDocument()
    expect(container.innerHTML).not.toMatch(/emerald|orange|text-success|text-destructive|gradient/)
  })
})
