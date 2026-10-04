import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BankAccountsData,
  EntriesData,
  EntrySummary,
  ReconciliationData,
  RulesData,
} from '@/lib/dashboard/load-widget-data.service'
import { getWidget, type WidgetDefinition, type WidgetSize } from '@/lib/dashboard/widgets'
import { DashboardDataProvider } from '../dashboard-data'
import type { WidgetProps } from '../widgets/types'
import {
  ARapprocherList,
  BrouillonsList,
  ComptesBancairesList,
  DernieresEcrituresList,
  ReglesList,
} from '../widgets/list-widgets'

const onboarding = { data: null, loading: false, reload: vi.fn(), setDismissed: vi.fn(), nextStep: null }
const fetchMock = vi.fn()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

/** Matches a French formatted amount whatever the no-break spaces are (U+202F, U+00A0). */
const eur = (text: string) => new RegExp(text.replace(/ /g, '\\s'))

function serve(body: unknown, status = 200) {
  fetchMock.mockImplementation(async () => Response.json(body, { status }))
}

function renderList(Component: ComponentType<WidgetProps>, id: string, size?: WidgetSize) {
  const widget = getWidget(id) as WidgetDefinition
  return render(
    <DashboardDataProvider companyId="c1" fiscalYearId="fy-2026" onboarding={onboarding}>
      <Component widget={widget} size={size ?? widget.defaultSize} editing={false} />
    </DashboardDataProvider>,
  )
}

const fiscalYear = { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }

function entry(id: string, extra: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id,
    entryNumber: `BQ-2026-00${id}`,
    date: '2026-03-02T00:00:00.000Z',
    description: `Écriture ${id}`,
    reference: null,
    status: 'validated',
    journalCode: 'BQ',
    journalLabel: 'Banque',
    totalCents: 123_456,
    ...extra,
  }
}

describe('ARapprocherList', () => {
  const data: ReconciliationData = {
    count: 7,
    recent: [
      {
        id: 't1',
        date: '2026-03-04T00:00:00.000Z',
        label: 'PRLV OVH',
        counterpartyName: 'OVH SAS',
        amountCents: -2_999,
        bankAccount: { name: 'qonto-main', displayName: 'Compte principal', iban: null },
      },
      {
        id: 't2',
        date: '2026-03-03T00:00:00.000Z',
        label: 'VIR CLIENT',
        counterpartyName: null,
        amountCents: 150_000,
        bankAccount: { name: 'Société Générale', displayName: null, iban: null },
      },
      {
        id: 't3',
        date: '2026-03-01T00:00:00.000Z',
        label: null,
        counterpartyName: null,
        amountCents: 1,
        bankAccount: { name: 'SG', displayName: null, iban: null },
      },
    ],
  }

  it('lists the latest transactions with signed amounts and links to the reconciliation', async () => {
    serve(data)
    renderList(ARapprocherList, 'list-a-rapprocher')
    const rows = within(await screen.findByRole('list', { name: 'Transactions à rapprocher' })).getAllByRole('listitem')
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/widgets?companyId=c1&source=reconciliation&fiscalYearId=fy-2026')
    expect(screen.getByText("7 transactions sans écriture, les plus récentes d'abord.")).toBeInTheDocument()
    expect(rows[0].textContent).toMatch(eur('^OVH SAS04/03/2026 · Compte principal-29,99 €$'))
    // Without a counterparty, the label; money in carries a plus sign.
    expect(rows[1].textContent).toMatch(eur('^VIR CLIENT03/03/2026 · Société Générale\\+1 500,00 €$'))
    expect(rows[2].textContent).toMatch(eur('^Transaction sans libellé01/03/2026 · SG\\+0,01 €$'))
    expect(screen.getByRole('link', { name: 'Ouvrir le rapprochement' })).toHaveAttribute('href', '/c1/reconciliation')
  })

  it('says there is nothing to reconcile', async () => {
    serve({ count: 0, recent: [] })
    renderList(ARapprocherList, 'list-a-rapprocher')
    expect(await screen.findByText('Rien à rapprocher')).toBeInTheDocument()
    expect(screen.getByText('Toutes les transactions ont leur écriture.')).toBeInTheDocument()
  })

  it('shows the error of the source with a retry', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'Accès refusé' }, { status: 403 }))
    const user = userEvent.setup()
    renderList(ARapprocherList, 'list-a-rapprocher')
    expect(await screen.findByRole('alert')).toHaveTextContent('Accès refusé')
    serve(data)
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('list', { name: 'Transactions à rapprocher' })).toBeInTheDocument()
  })
})

describe('BrouillonsList', () => {
  const drafts: EntriesData = {
    fiscalYear,
    count: 12,
    entries: [entry('1'), entry('2', { description: null, reference: 'FA-42', totalCents: 5 })],
  }

  it('counts the drafts and lists the latest, each linking to its entry', async () => {
    serve(drafts)
    renderList(BrouillonsList, 'list-brouillons', 'M')
    expect(await screen.findByText(/12 écritures en brouillon\./)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/widgets?companyId=c1&source=drafts&fiscalYearId=fy-2026')
    expect(screen.getByText('Exercice 2026')).toBeInTheDocument()
    expect(screen.getByText('12', { selector: 'span' })).toBeInTheDocument()
    const links = within(screen.getByRole('list', { name: 'Brouillons les plus récents' })).getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/c1/entries/1')
    expect(links[0].textContent).toMatch(eur('^Écriture 102/03/2026 · BQ · BQ-2026-0011 234,56 €$'))
    // Without a description, the reference names the entry.
    expect(links[1].textContent).toMatch(eur('^FA-42.*0,05 €$'))
    expect(screen.getByRole('link', { name: 'Voir les brouillons' })).toHaveAttribute('href', '/c1/entries?statut=brouillon')
  })

  it('shows only the count at the small size', async () => {
    serve({ ...drafts, count: 1 })
    renderList(BrouillonsList, 'list-brouillons', 'S')
    expect(await screen.findByText(/1 écriture en brouillon\./)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('says when there is no draft, or no fiscal year', async () => {
    serve({ fiscalYear, count: 0, entries: [] })
    const { unmount } = renderList(BrouillonsList, 'list-brouillons')
    expect(await screen.findByText('Aucun brouillon à valider')).toBeInTheDocument()
    unmount()

    serve({ fiscalYear: null })
    renderList(BrouillonsList, 'list-brouillons')
    expect(await screen.findByText('Aucun exercice')).toBeInTheDocument()
  })

  it('shows the error of the source', async () => {
    serve({ error: 'Erreur serveur' }, 500)
    renderList(BrouillonsList, 'list-brouillons')
    expect(await screen.findByRole('alert')).toHaveTextContent('Erreur serveur')
  })
})

describe('DernieresEcrituresList', () => {
  it('lists the latest entries with their total and a draft badge', async () => {
    serve({
      fiscalYear,
      entries: [
        entry('1', { status: 'draft', totalCents: 9_999_999 }),
        entry('2', { description: null, reference: null, entryNumber: 'VT-2026-0007' }),
      ],
    })
    renderList(DernieresEcrituresList, 'list-dernieres-ecritures')
    const links = within(await screen.findByRole('list', { name: 'Écritures les plus récentes' })).getAllByRole('link')
    expect(links[0].textContent).toMatch(eur('99 999,99 €Brouillon$'))
    // Without description nor reference, the entry number names it.
    expect(links[1].textContent).toMatch(/^Écriture VT-2026-0007/)
    expect(within(links[1]).queryByText('Brouillon')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Toutes les écritures' })).toHaveAttribute('href', '/c1/entries')
  })

  it('offers to enter an entry when the year has none', async () => {
    serve({ fiscalYear, entries: [] })
    const { unmount } = renderList(DernieresEcrituresList, 'list-dernieres-ecritures')
    expect(await screen.findByText("Aucune écriture sur l'exercice")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Saisir une écriture' })).toHaveAttribute('href', '/c1/entries/new')
    unmount()

    serve({ fiscalYear: null })
    const second = renderList(DernieresEcrituresList, 'list-dernieres-ecritures')
    expect(await screen.findByText('Aucun exercice')).toBeInTheDocument()
    second.unmount()

    serve({ error: 'Panne' }, 500)
    renderList(DernieresEcrituresList, 'list-dernieres-ecritures')
    expect(await screen.findByRole('alert')).toHaveTextContent('Panne')
  })
})

describe('ComptesBancairesList', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))
  })

  const account = (id: string, extra: Partial<BankAccountsData['accounts'][number]> = {}): BankAccountsData['accounts'][number] => ({
    id,
    name: `Compte ${id}`,
    displayName: null,
    iban: null,
    provider: 'QONTO',
    balanceCents: 0,
    currency: 'EUR',
    shouldSync: true,
    lastSyncedAt: null,
    hasSyncError: false,
    consentExpiresAt: null,
    ...extra,
  })

  it('shows each balance, the euro total, and the state of each bank access', async () => {
    serve({
      accounts: [
        account('a', { balanceCents: 1_250_075, lastSyncedAt: '2026-03-14T12:00:00.000Z', consentExpiresAt: '2026-03-17T12:00:00.000Z' }),
        account('b', { provider: 'REVOLUT', balanceCents: -5_000, consentExpiresAt: '2026-03-10T00:00:00.000Z' }),
        account('c', { provider: 'PONTO', balanceCents: 100, hasSyncError: true, consentExpiresAt: '2026-06-01T00:00:00.000Z' }),
        account('d', { provider: 'OTHERBANK', balanceCents: 99_900, currency: 'USD' }),
      ],
    })
    renderList(ComptesBancairesList, 'list-comptes-bancaires')
    const rows = within(await screen.findByRole('list', { name: 'Comptes bancaires' })).getAllByRole('listitem')
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/widgets?companyId=c1&source=bank-accounts&fiscalYearId=fy-2026')

    // Consent ends in 2 days: within the 3 day urgent window (lib/banking/consent.ts).
    expect(rows[0].textContent).toMatch(/^Compte aQontoSynchronisé le 14\/03\/2026 \d{2}:\d{2}Accès à renouveler \(2 jours\)/)
    expect(rows[0].textContent).toMatch(eur('12 500,75 €$'))
    expect(within(rows[1]).getByText('Accès expiré').closest('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger')
    expect(rows[1].textContent).toMatch(eur('Revolut Business.*-50,00 €$'))
    expect(within(rows[2]).getByText('Synchronisation en erreur')).toBeInTheDocument()
    expect(rows[2].textContent).toMatch(/^Compte cPonto/)
    // Another currency is shown in its own currency, and left out of the euro total.
    expect(rows[3].textContent).toMatch(/^Compte dOTHERBANK/)
    expect(rows[3].textContent).toMatch(/999,00\s\$US$/)
    const header = screen.getByRole('heading', { name: 'Comptes bancaires' }).closest('[role="region"]') as HTMLElement
    // 12 500,75 - 50,00 + 1,00 = 12 451,75 EUR.
    expect(header.textContent).toMatch(eur('12 451,75 €'))
    expect(screen.getByRole('link', { name: 'Gérer les comptes' })).toHaveAttribute('href', '/c1/banking')
  })

  it('shows no total for a single account, and the warning 14 days ahead', async () => {
    serve({ accounts: [account('a', { balanceCents: 4_200, consentExpiresAt: '2026-03-25T12:00:00.000Z' })] })
    renderList(ComptesBancairesList, 'list-comptes-bancaires')
    const rows = within(await screen.findByRole('list', { name: 'Comptes bancaires' })).getAllByRole('listitem')
    expect(within(rows[0]).getByText('Accès à renouveler (10 jours)')).toBeInTheDocument()
    expect(screen.getAllByText(eur('^42,00 €$'))).toHaveLength(1)
  })

  it('offers to connect a bank when there is no account', async () => {
    serve({ accounts: [] })
    const { unmount } = renderList(ComptesBancairesList, 'list-comptes-bancaires')
    expect(await screen.findByText('Aucun compte bancaire')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connecter une banque' })).toHaveAttribute('href', '/c1/banking')
    unmount()

    serve({ error: 'Panne' }, 500)
    renderList(ComptesBancairesList, 'list-comptes-bancaires')
    expect(await screen.findByRole('alert')).toHaveTextContent('Panne')
  })
})

describe('ReglesList', () => {
  it('lists the most used rules with their usage, last use and an inactive badge', async () => {
    const data: RulesData = {
      total: 4,
      rules: [
        { id: 'r1', name: 'Loyer', usageCount: 12, lastUsedAt: '2026-03-01T09:00:00.000Z', enabled: true },
        { id: 'r2', name: 'Frais bancaires', usageCount: 1, lastUsedAt: null, enabled: false },
      ],
    }
    serve(data)
    renderList(ReglesList, 'list-regles')
    const rows = within(await screen.findByRole('list', { name: 'Règles les plus utilisées' })).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('LoyerDernière utilisation le 01/03/202612 transactions')
    expect(rows[1]).toHaveTextContent('Frais bancaires1 transactionInactive')
    expect(screen.getByRole('link', { name: 'Toutes les règles' })).toHaveAttribute('href', '/c1/rules')
  })

  it('distinguishes no rule at all from rules never used', async () => {
    serve({ total: 0, rules: [] })
    const { unmount } = renderList(ReglesList, 'list-regles')
    expect(await screen.findByText("Aucune règle d'affectation")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Créer une règle' })).toHaveAttribute('href', '/c1/rules')
    unmount()

    serve({ total: 3, rules: [] })
    const second = renderList(ReglesList, 'list-regles')
    expect(await screen.findByText("Aucune règle n'a encore servi")).toBeInTheDocument()
    second.unmount()

    serve({ error: 'Panne' }, 500)
    renderList(ReglesList, 'list-regles')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Panne'))
  })
})
