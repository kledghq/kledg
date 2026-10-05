import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LedgerData } from '@/lib/dashboard/load-widget-data.service'
import type { LedgerSummary } from '@/lib/dashboard/ledger-summary'
import { getWidget, type WidgetDefinition } from '@/lib/dashboard/widgets'
import { DashboardDataProvider } from '../dashboard-data'
import type { WidgetProps } from '../widgets/types'
import {
  ARapprocherKpi,
  ChargesKpi,
  ChiffreAffairesKpi,
  CreancesClientsKpi,
  DettesFournisseursKpi,
  MargeKpi,
  ProduitsKpi,
  ResultatKpi,
  TresorerieKpi,
  TvaKpi,
} from '../widgets/kpi-widgets'

const onboarding = { data: null, loading: false, reload: vi.fn(), setDismissed: vi.fn(), nextStep: null }
const fetchMock = vi.fn()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

/** Matches a French formatted amount whatever the no-break spaces are (U+202F, U+00A0). */
const eur = (text: string) => new RegExp(text.replace(/ /g, '\\s'))

function summary(overrides: Partial<LedgerSummary> = {}): LedgerSummary {
  return {
    produitsCents: 15_000_000,
    chargesCents: 9_876_543,
    resultatCents: 5_123_457,
    chiffreAffairesCents: 1_234_567,
    marge: null,
    tvaCents: null,
    creancesClientsCents: 420_000,
    dettesFournisseursCents: 133_700,
    banqueCents: 800_050,
    chargesParPoste: [],
    autresChargesCents: 0,
    ...overrides,
  }
}

function ledger(overrides: Partial<LedgerData> = {}, summaryOverrides: Partial<LedgerSummary> = {}): LedgerData {
  return {
    fiscalYear: { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
    asOf: '2026-03-15',
    summary: summary(summaryOverrides),
    previous: {
      year: 2025,
      startDate: '2025-01-01',
      endDate: '2025-03-15',
      produitsCents: 9_000_000,
      chargesCents: 7_000_000,
      resultatCents: -250_000,
      chiffreAffairesCents: 1_000_000,
    },
    bank: { balanceCents: 812_345, accounts: 2, otherCurrencies: 0 },
    ...overrides,
  }
}

function renderKpi(Component: ComponentType<WidgetProps>, id: string) {
  const widget = getWidget(id) as WidgetDefinition
  return render(
    <DashboardDataProvider companyId="c1" fiscalYearId="fy-2026" onboarding={onboarding}>
      <Component widget={widget} size="S" editing={false} />
    </DashboardDataProvider>,
  )
}

/** The value line of the tile (under its heading). */
function value(): HTMLElement {
  const card = screen.getByRole('heading', { level: 2 }).closest('[data-slot="stat-card"]') as HTMLElement
  return card.children[1] as HTMLElement
}

function serve(body: unknown, status = 200) {
  // A fresh Response per call: a body can be read once.
  fetchMock.mockImplementation(async () => Response.json(body, { status }))
}

describe('ledger KPI tiles', () => {
  it("shows the chiffre d'affaires in euros from cents, compared with the same span of the previous year", async () => {
    serve(ledger())
    renderKpi(ChiffreAffairesKpi, 'kpi-chiffre-affaires')
    expect(screen.getByText('Chargement')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 }).closest('[data-slot="stat-card"]')).toHaveAttribute('aria-busy', 'true')

    await waitFor(() => expect(value().textContent).toMatch(eur('^12 345,67 €$')))
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/widgets?companyId=c1&source=ledger&fiscalYearId=fy-2026')
    const hint = screen.getByText(/Même période en 2025/)
    expect(hint.textContent).toMatch(eur('^Même période en 2025 : 10 000,00 €$'))
    expect(hint).toHaveAttribute('title', 'Du 01/01/2025 au 15/03/2025')
  })

  it('says when there is no previous year to compare with', async () => {
    serve(ledger({ previous: null }))
    renderKpi(ProduitsKpi, 'kpi-produits')
    // 15 000 000 cents is 150 000 EUR, below the compact threshold of ten million euros.
    await waitFor(() => expect(value().textContent).toMatch(eur('^150 000,00 €$')))
    expect(screen.getByText("Pas d'exercice précédent pour comparer")).toBeInTheDocument()
  })

  it('shows the charges of the year and of the previous span', async () => {
    serve(ledger())
    renderKpi(ChargesKpi, 'kpi-charges')
    await waitFor(() => expect(value().textContent).toMatch(eur('^98 765,43 €$')))
    expect(screen.getByText(/Même période en 2025/).textContent).toMatch(eur('70 000,00 €'))
  })

  it('marks a profit and a loss', async () => {
    serve(ledger())
    const { unmount } = renderKpi(ResultatKpi, 'kpi-resultat')
    await waitFor(() => expect(value().textContent).toMatch(eur('^51 234,57 €$')))
    expect(screen.getByText('Bénéfice').closest('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success')
    expect(value()).not.toHaveClass('text-destructive')
    // The previous span was a loss: shown negative.
    expect(screen.getByText(/Même période en 2025/).textContent).toMatch(eur('-2 500,00 €'))
    unmount()

    serve(ledger({}, { resultatCents: -150_000 }))
    renderKpi(ResultatKpi, 'kpi-resultat')
    await waitFor(() => expect(value().textContent).toMatch(eur('^-1 500,00 €$')))
    expect(value()).toHaveClass('text-destructive')
    expect(screen.getByText('Perte').closest('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger')
  })

  it('calls a zero result neither a profit nor a loss', async () => {
    serve(ledger({}, { resultatCents: 0 }))
    renderKpi(ResultatKpi, 'kpi-resultat')
    await waitFor(() => expect(value().textContent).toMatch(eur('^0,00 €$')))
    expect(screen.queryByText('Bénéfice')).toBeNull()
    expect(screen.queryByText('Perte')).toBeNull()
  })

  it('shows the ledger cash and the balance the banks report', async () => {
    serve(ledger())
    const { unmount } = renderKpi(TresorerieKpi, 'kpi-tresorerie')
    await waitFor(() => expect(value().textContent).toMatch(eur('^8 000,50 €$')))
    expect(screen.getByText(/Selon vos banques/).textContent).toMatch(eur('^Selon vos banques : 8 123,45 €$'))
    unmount()

    serve(ledger({ bank: { balanceCents: 0, accounts: 0, otherCurrencies: 0 } }, { banqueCents: -12_000 }))
    renderKpi(TresorerieKpi, 'kpi-tresorerie')
    await waitFor(() => expect(value().textContent).toMatch(eur('^-120,00 €$')))
    expect(value()).toHaveClass('text-destructive')
    expect(screen.getByText('Comptes 512 en comptabilité')).toBeInTheDocument()
  })

  it('shows VAT to pay, a VAT credit as a positive amount, or no VAT', async () => {
    // Comptes 445: credit minus debit, positive is VAT to pay (PCG art. 944-44).
    serve(ledger({}, { tvaCents: 245_000 }))
    const first = renderKpi(TvaKpi, 'kpi-tva')
    await waitFor(() => expect(value().textContent).toMatch(eur('^2 450,00 €$')))
    expect(screen.getByText('TVA à payer')).toBeInTheDocument()
    expect(screen.getByText('Estimation')).toBeInTheDocument()
    first.unmount()

    serve(ledger({}, { tvaCents: -32_000 }))
    const second = renderKpi(TvaKpi, 'kpi-tva')
    await waitFor(() => expect(value().textContent).toMatch(eur('^320,00 €$')))
    expect(screen.getByText('Crédit de TVA')).toBeInTheDocument()
    second.unmount()

    serve(ledger({}, { tvaCents: null }))
    renderKpi(TvaKpi, 'kpi-tva')
    expect(await screen.findByText('Aucune TVA')).toBeInTheDocument()
    expect(screen.getByText('Aucune écriture sur les comptes 445 cet exercice')).toBeInTheDocument()
  })

  it('shows the commercial margin and the merchandise sales, or says it does not apply', async () => {
    serve(ledger({}, { marge: { ventesCents: 5_000_000, coutCents: 5_120_000, margeCents: -120_000 } }))
    const first = renderKpi(MargeKpi, 'kpi-marge')
    await waitFor(() => expect(value().textContent).toMatch(eur('^-1 200,00 €$')))
    expect(value()).toHaveClass('text-destructive')
    expect(screen.getByText(/Ventes de marchandises/).textContent).toMatch(eur('^Ventes de marchandises : 50 000,00 €$'))
    first.unmount()

    serve(ledger({}, { marge: { ventesCents: 100_000, coutCents: 40_000, margeCents: 60_000 } }))
    const second = renderKpi(MargeKpi, 'kpi-marge')
    await waitFor(() => expect(value().textContent).toMatch(eur('^600,00 €$')))
    expect(value()).not.toHaveClass('text-destructive')
    second.unmount()

    serve(ledger())
    renderKpi(MargeKpi, 'kpi-marge')
    expect(await screen.findByText('Sans objet')).toBeInTheDocument()
    expect(screen.getByText('Aucune vente ni achat de marchandises cet exercice')).toBeInTheDocument()
  })

  it('shows the customer receivables (411) and the supplier debts (401)', async () => {
    serve(ledger())
    const first = renderKpi(CreancesClientsKpi, 'kpi-creances-clients')
    await waitFor(() => expect(value().textContent).toMatch(eur('^4 200,00 €$')))
    expect(screen.getByText('Solde des comptes clients (411)')).toBeInTheDocument()
    first.unmount()

    renderKpi(DettesFournisseursKpi, 'kpi-dettes-fournisseurs')
    await waitFor(() => expect(value().textContent).toMatch(eur('^1 337,00 €$')))
    expect(screen.getByText('Solde des comptes fournisseurs (401)')).toBeInTheDocument()
  })

  it('says when the company has no fiscal year', async () => {
    serve({ fiscalYear: null })
    renderKpi(ChiffreAffairesKpi, 'kpi-chiffre-affaires')
    expect(await screen.findByText('Aucun exercice')).toBeInTheDocument()
  })

  it('shows the API error inside the tile and retries', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Exercice introuvable' }, { status: 404 }))
    const user = userEvent.setup()
    renderKpi(ChiffreAffairesKpi, 'kpi-chiffre-affaires')
    expect(await screen.findByRole('alert')).toHaveTextContent('Exercice introuvable')
    expect(screen.queryByText('Aucun exercice')).not.toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(Response.json(ledger()))
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(value().textContent).toMatch(eur('^12 345,67 €$')))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses a compact amount from ten million euros, the full amount for screen readers', async () => {
    serve(ledger({}, { chiffreAffairesCents: 1_234_567_890 }))
    renderKpi(ChiffreAffairesKpi, 'kpi-chiffre-affaires')
    await waitFor(() => expect(value().querySelector('[aria-hidden]')?.textContent).toMatch(/^12,3\sM\s?€$/))
    expect(value().querySelector('.sr-only')?.textContent).toMatch(eur('^12 345 678,90 €$'))
  })
})

describe('ARapprocherKpi', () => {
  it('counts the transactions without an entry and links to the reconciliation', async () => {
    serve({ count: 3, recent: [] })
    renderKpi(ARapprocherKpi, 'kpi-a-rapprocher')
    await waitFor(() => expect(value()).toHaveTextContent('3'))
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/widgets?companyId=c1&source=reconciliation&fiscalYearId=fy-2026')
    expect(screen.getByText('Transactions sans écriture')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rapprocher' })).toHaveAttribute('href', '/c1/reconciliation')
  })

  it('uses the singular for one transaction (French plural from 2)', async () => {
    serve({ count: 1, recent: [] })
    renderKpi(ARapprocherKpi, 'kpi-a-rapprocher')
    expect(await screen.findByText('Transaction sans écriture')).toBeInTheDocument()
  })

  it('says everything is up to date', async () => {
    serve({ count: 0, recent: [] })
    renderKpi(ARapprocherKpi, 'kpi-a-rapprocher')
    expect(await screen.findByText('Toutes les transactions ont leur écriture')).toBeInTheDocument()
    expect(screen.getByText('À jour').closest('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success')
    expect(screen.queryByRole('link', { name: 'Rapprocher' })).not.toBeInTheDocument()
  })

  it('shows a loading state, then the error with a retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderKpi(ARapprocherKpi, 'kpi-a-rapprocher')
    expect(screen.getByText('Chargement')).toBeInTheDocument()
    // A network failure reads as the generic message, not "Failed to fetch".
    expect(await screen.findByRole('alert')).toHaveTextContent('Ces données ne se sont pas chargées. Réessayez dans un instant.')
  })
})
