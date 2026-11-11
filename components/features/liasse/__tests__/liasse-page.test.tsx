/**
 * Liasse fiscale page: the list of the tables of the regime with where each
 * is prepared (a link to the page that prepares it, or "À remplir à la
 * main"), then the tables prepared here stacked under their headings (no
 * tabs, docs/design-system.md), each box with its code, and "À remplir" with
 * the reason when the books do not give it. Data built by the real pure
 * modules (lib/liasse).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LiassePage } from '../liasse-page'
import { assembleLiasse, type LiasseView } from '@/lib/liasse/build-liasse'
import { buildForm2033D } from '@/lib/liasse/form-2033d'
import { vatTotals } from '@/lib/liasse/vat'

const FISCAL_YEARS = [{ id: 'fy26', year: 2026, startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-12-31T00:00:00.000Z', isClosed: true }]
const base = {
  company: { name: 'Atelier Lumen', siren: '111111111' },
  fiscalYear: { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: true },
  warnings: [],
}
const READY = assembleLiasse({
  ...base,
  status: 'ready',
  regime: 'simplified',
  forms: [
    buildForm2033D({
      provisions: {
        movements: [{ code: '151100', openingCents: 100_000, increaseCents: 50_000, decreaseCents: 0, closingCents: 150_000 }],
        register: [],
        balanceSheet: { regulated: { box: '140', cents: 0 }, riskCharges: { box: '154', cents: 150_000 } },
        incomeStatement: null,
      },
      deficits: null,
      deficitsWhy: "Aucun calcul de l'impôt sur les sociétés pour cet exercice.",
      vat: vatTotals([]),
    }),
  ],
})

function serve(view: LiasseView) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/companies/acme/fiscal-years')) return new Response(JSON.stringify(FISCAL_YEARS), { status: 200 })
      if (url.startsWith('/api/reports/liasse')) return new Response(JSON.stringify(view), { status: 200 })
      return new Response(JSON.stringify({ error: 'inattendu' }), { status: 500 })
    }),
  )
}

describe('LiassePage', () => {
  beforeEach(() => serve(READY))
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists every table of the regime with where it is prepared', async () => {
    render(<LiassePage companyId="acme" />)
    const list = await screen.findByRole('table', { name: 'Tableaux de la liasse' })
    const rows = within(list).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['2065-SD', '2033-A-SD', '2033-B-SD', '2033-B-SD', '2033-C-SD', '2033-D-SD', '2033-E-SD', '2033-F-SD', '2033-G-SD'])
    expect(within(rows[4]).getByRole('link', { name: 'Ouvrir la page' })).toHaveAttribute('href', '/acme/reports/fixed-asset-movements')
    expect(within(rows[5]).getByRole('link', { name: 'Plus bas' })).toHaveAttribute('href', '#form-2033-D')
    expect(screen.getByText('Régime simplifié')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument()
  })

  it('stacks the tables prepared here under their headings, with the box codes and what is to fill by hand', async () => {
    render(<LiassePage companyId="acme" />)
    const section = await screen.findByRole('region', { name: /^2033-D-SD/ })
    expect(screen.queryByRole('tablist')).toBeNull()
    const relevé = within(section).getByRole('table', { name: 'I A. Relevé des provisions, amortissements dérogatoires' })
    expect(within(relevé).getByText('626')).toBeInTheDocument()
    const deficits = within(section).getByRole('table', { name: 'II. Déficits reportables' })
    expect(within(deficits).getAllByText('À remplir').length).toBeGreaterThan(0)
    expect(within(deficits).getAllByText("Aucun calcul de l'impôt sur les sociétés pour cet exercice.").length).toBeGreaterThan(0)
  })

  it('asks for the regime when it is not set', async () => {
    serve(assembleLiasse({ ...base, status: 'missing-regime', regime: null, forms: [] }))
    render(<LiassePage companyId="acme" />)
    expect(await screen.findByText("Le régime d'impôt sur les sociétés n'est pas renseigné")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Renseigner le régime' })).toHaveAttribute('href', '/acme/informations')
  })
})
