/**
 * Pages of the year-end work: the provisions and impairments with the
 * movement of the closing, the assessment sent in cents for the fiscal year
 * shown, no action for a read-only member; the Travaux de clôture page and
 * its preparation of draft entries; the capital composition with its checks.
 * Data built by the real pure modules (lib/year-end/inventory.ts,
 * lib/reports/capital-composition/compute.ts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { toast } from 'sonner'
import { ProvisionsPage } from '../provisions-page'
import { YearEndPage } from '../year-end-page'
import { CapitalCompositionPage } from '../capital-composition-page'
import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { grantedPermissions } from '@/lib/rbac/granted-permissions'
import { grantYear, provisionYear, type YearRef } from '@/lib/year-end/inventory'
import { buildCapitalComposition } from '@/lib/reports/capital-composition/compute'
import type { GrantView, ProvisionView, YearEndInventory } from '@/lib/year-end/get-year-end-inventory.service'

const plain = (text: string | null) => (text ?? '').replace(/[\s  ]+/g, ' ').trim()

const YEAR: YearRef = { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }
const FISCAL_YEARS = [{ id: 'fy26', year: 2026, startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z', isClosed: false }]

const provision: ProvisionView = {
  ...provisionYear(
    {
      id: 'p1', category: 'RISK_CHARGE', label: 'Litige fournisseur', accountCode: '1511', nature: 'OPERATING', reversible: true,
      openedOn: '2026-02-01', closedOn: null, carriedCents: 0,
      assessments: [{ fiscalYearId: 'fy26', amountCents: 1_234_567, currentValueCents: null, basis: null, entry: null }],
    },
    YEAR,
    [YEAR],
  ),
  id: 'p1', category: 'RISK_CHARGE', label: 'Litige fournisseur', justification: 'Assignation', accountCode: '1511', accountLabel: 'Provisions pour litiges',
  nature: 'OPERATING', taxDeductible: true, reversible: true, fixedAsset: null, tiersCode: null, openedOn: '2026-02-01', closedOn: null, carriedCents: 0,
}
const grant: GrantView = {
  ...grantYear({ id: 'g1', label: 'Aide régionale', amountCents: 500_000, spreading: 'TENTHS', grantedOn: '2026-04-01', durationYears: null, transferAccountCode: '139', carriedCents: 0, transfers: [] }, YEAR, [YEAR], null),
  id: 'g1', label: 'Aide régionale', grantor: 'Région', amountCents: 500_000, grantedOn: '2026-04-01', spreading: 'TENTHS', durationYears: null,
  fixedAsset: null, accountCode: '131', transferAccountCode: '139', incomeAccountCode: '747', carriedCents: 0, notes: null,
}
const INVENTORY: YearEndInventory = {
  fiscalYear: YEAR,
  provisions: [provision],
  grants: [grant],
  totals: { dotationsCents: 1_234_567, reprisesCents: 0, transfersCents: 50_000, toAssess: 0, toCorrect: 0 },
}

describe('year-end pages', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/companies/acme/fiscal-years')) return new Response(JSON.stringify(FISCAL_YEARS), { status: 200 })
      if (init?.method === 'PUT') return new Response(JSON.stringify({ amountCents: 900_000 }), { status: 200 })
      if (init?.method === 'POST' && url === '/api/year-end/entries') {
        return new Response(JSON.stringify({ created: [{ kind: 'provision', itemId: 'p1', label: 'Litige fournisseur', entryId: 'e1', cents: 1_234_567 }], skipped: [] }), { status: 201 })
      }
      if (url.startsWith('/api/provisions/doubtful-receivables')) return new Response(JSON.stringify({ asOf: '2026-12-31', minDaysOverdue: 90, items: [] }), { status: 200 })
      if (url.startsWith('/api/provisions')) return new Response(JSON.stringify({ fiscalYear: YEAR, provisions: INVENTORY.provisions }), { status: 200 })
      if (url.startsWith('/api/year-end')) return new Response(JSON.stringify(INVENTORY), { status: 200 })
      if (url.startsWith('/api/reports/capital-composition')) {
        const composition = buildCapitalComposition({ legalType: 'SAS', shareCapitalCents: 1_000_000, totalShares: 1_000, nominalCents: 1_000 }, [
          { id: 's1', kind: 'PHYSICAL', name: 'Camille Martin', siren: null, shares: 900, percentHundredths: 9_000, capitalCents: null },
          { id: 's2', kind: 'LEGAL', name: 'Holding Exemple', siren: '123456789', shares: 50, percentHundredths: 500, capitalCents: null },
        ])
        return new Response(JSON.stringify({ ...composition, company: { name: 'Atelier', siren: '111111111', legalType: 'SAS' }, fiscalYear: { id: 'fy26', year: 2026, endDate: '2026-12-31' }, bookedCapitalCents: 1_000_000 }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'inattendu' }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('lists the provisions of the closing and sends an assessment in cents', async () => {
    const user = userEvent.setup()
    render(<ProvisionsPage companyId="acme" />)
    const table = await screen.findByRole('table')
    expect(fetchMock).toHaveBeenCalledWith('/api/provisions?companyId=acme&fiscalYearId=fy26')
    const row = plain(within(table).getAllByRole('row')[1].textContent)
    expect(row).toContain('Litige fournisseur')
    expect(row).toContain('Dotation 12 345,67 €')
    expect(row).toContain('À comptabiliser')

    await user.click(within(table).getByRole('button', { name: 'Actions sur Litige fournisseur' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Évaluer à la clôture' }))
    const amount = await screen.findByLabelText(/Montant requis à la clôture/)
    await user.clear(amount)
    await user.type(amount, '9000')
    await user.click(screen.getByRole('button', { name: "Enregistrer l'évaluation" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Évaluation enregistrée'))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PUT') as [string, RequestInit]
    expect(url).toBe('/api/provisions/p1/assessment')
    expect(JSON.parse(init.body as string)).toEqual({ fiscalYearId: 'fy26', amountCents: 900_000, basis: null })
  })

  it('shows no action to a read-only member', async () => {
    render(
      <CompanyAccessProvider value={{ granted: grantedPermissions(['viewer'], false), roleLabel: 'Lecture seule' }}>
        <ProvisionsPage companyId="acme" />
      </CompanyAccessProvider>,
    )
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Litige fournisseur')).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /Actions sur/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nouvelle provision' })).toBeNull()
  })

  it('prepares the year-end entries as drafts', async () => {
    const user = userEvent.setup()
    render(<YearEndPage companyId="acme" />)
    const table = await screen.findByRole('table')
    expect(plain(table.textContent)).toContain('Aide régionale139Quote-part 500,00 €')
    expect(plain(document.body.textContent)).toMatch(/Dotations à comptabiliser ?12 345,67 €/)
    await user.click(screen.getByRole('button', { name: 'Préparer les écritures' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('1 écriture préparée en brouillon'))
    const [, init] = fetchMock.mock.calls.find(([u]) => u === '/api/year-end/entries') as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ companyId: 'acme', fiscalYearId: 'fy26' })
  })

  it('shows the capital composition with its checks', async () => {
    render(<CapitalCompositionPage companyId="acme" />)
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').map((r) => plain(r.textContent))
    expect(rows[1]).toContain('Camille Martin')
    expect(rows[1]).toContain('90 %')
    expect(rows[1]).toContain('9 000,00 €')
    expect(screen.getByText(/Les actionnaires détiennent 950 actions sur 1 000/)).toBeInTheDocument()
  })
})
