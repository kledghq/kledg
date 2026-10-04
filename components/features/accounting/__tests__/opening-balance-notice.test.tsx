import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpeningBalanceNotice } from '../opening-balance-notice'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const COMPANY = 'co-1'
const FY = { id: 'fy-2025', year: 2025, startDate: '2025-01-01T00:00:00.000Z', isClosed: false }

function stubTarget(target: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => ({ target }) }) as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('OpeningBalanceNotice', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('invites to enter the opening balance sheet of a company older than its first fiscal year', async () => {
    const fetchMock = stubTarget({ fiscalYear: FY, existingEntry: null })
    render(<OpeningBalanceNotice companyId={COMPANY} foundationDate="2019-05-02" firstFiscalYearStart="2025-01-01" />)

    expect(await screen.findByText("Reprendre le bilan d'ouverture")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/companies/${COMPANY}/opening-balances`)
    expect(screen.getByText(/commence le 1 janvier 2025/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Saisir le bilan d'ouverture" })).toHaveAttribute(
      'href',
      `/${COMPANY}/fiscal-years/opening-balances`
    )
  })

  it('also applies when the foundation date is unknown', async () => {
    stubTarget({ fiscalYear: FY, existingEntry: null })
    render(<OpeningBalanceNotice companyId={COMPANY} foundationDate={null} firstFiscalYearStart="2025-01-01" />)
    expect(await screen.findByText("Reprendre le bilan d'ouverture")).toBeInTheDocument()
  })

  it('confirms a booked opening balance sheet and flags a draft', async () => {
    stubTarget({ fiscalYear: FY, existingEntry: { id: 'e-1', status: 'draft' } })
    const { container } = render(
      <OpeningBalanceNotice companyId={COMPANY} foundationDate="2019-05-02" firstFiscalYearStart="2025-01-01" />
    )
    await screen.findByRole('link', { name: "Voir le bilan d'ouverture" })
    expect(container.textContent).toBe("Bilan d'ouverture de l'exercice 2025 saisi (brouillon).Voir le bilan d'ouverture")
  })

  it('stays hidden for a company created on the first day of its first fiscal year', () => {
    const fetchMock = stubTarget({ fiscalYear: FY, existingEntry: null })
    const { container } = render(
      <OpeningBalanceNotice companyId={COMPANY} foundationDate="2025-01-01" firstFiscalYearStart="2025-01-01" />
    )
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stays hidden when the first fiscal year is closed', async () => {
    const fetchMock = stubTarget({ fiscalYear: { ...FY, isClosed: true }, existingEntry: null })
    const { container } = render(
      <OpeningBalanceNotice companyId={COMPANY} foundationDate="2019-05-02" firstFiscalYearStart="2025-01-01" />
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
