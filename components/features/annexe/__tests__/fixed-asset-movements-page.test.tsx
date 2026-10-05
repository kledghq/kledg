/**
 * Immobilisations et amortissements: the forms 2054, 2055 and 2033-C are
 * stacked on the page, each under its heading, all visible at once (no
 * tabs, docs/design-system.md). Data built by the real pure module
 * (lib/annexe/fixed-asset-report.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { FixedAssetMovementsPage } from '../fixed-asset-movements-page'
import { buildFixedAssetReport } from '@/lib/annexe/fixed-asset-report'

const FISCAL_YEARS = [{ id: 'fy26', year: 2026, startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z', isClosed: false }]
const REPORT = buildFixedAssetReport({
  fiscalYear: { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
  lines: [
    { entryId: 'e1', reversalOfId: null, opening: false, code: '218300', debitCents: 240_000, creditCents: 0 },
    { entryId: 'e1', reversalOfId: null, opening: false, code: '404000', debitCents: 0, creditCents: 240_000 },
    { entryId: 'e2', reversalOfId: null, opening: false, code: '681120', debitCents: 40_000, creditCents: 0 },
    { entryId: 'e2', reversalOfId: null, opening: false, code: '281830', debitCents: 0, creditCents: 40_000 },
  ],
  impairmentCents: 0,
  balanceSheet: { grossCents: 240_000, depreciationCents: 40_000 },
  register: [],
  draftEntries: 0,
})

describe('FixedAssetMovementsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/companies/acme/fiscal-years')) return new Response(JSON.stringify(FISCAL_YEARS), { status: 200 })
        if (url.startsWith('/api/reports/fixed-asset-movements')) return new Response(JSON.stringify(REPORT), { status: 200 })
        return new Response(JSON.stringify({ error: 'inattendu' }), { status: 500 })
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stacks the three forms, each under its heading, with no tabs', async () => {
    render(<FixedAssetMovementsPage companyId="acme" />)
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual(['2054, immobilisations', '2055, amortissements', '2033-C, régime simplifié'])
    expect(screen.queryByRole('tablist')).toBeNull()
    // Every form table is in the page at once
    for (const caption of ['2054-SD, cadre A', '2054-SD, cadre B', '2055-SD, cadre A', '2033-C-SD, cadre I', '2033-C-SD, cadre II']) {
      expect(screen.getByRole('table', { name: caption })).toBeVisible()
    }
    const section2055 = screen.getByRole('region', { name: '2055, amortissements' })
    expect(within(section2055).getByRole('table', { name: '2055-SD, cadre A' })).toBeInTheDocument()
  })
})
