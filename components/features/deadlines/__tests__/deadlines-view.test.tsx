/**
 * Échéances page body (DeadlinesPage): deadlines grouped by month with how
 * far each one is (relative to the server's today), the filter by category,
 * the rule and official source behind a date (CGI art. 287 for the CA3,
 * postponed to the next working day), the notices, and the error and empty
 * states. fetch is mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/echeances',
}))
vi.mock('@/hooks/ui/use-media-query', () => ({ useMediaQuery: () => false }))
vi.mock('@/components/features/accounting/fiscal-year-selector', () => ({ FiscalYearSelector: () => null }))

import { DeadlinesPage } from '../deadlines-view'
import { deriveStatus } from '@/lib/declarations/status'
import type { Deadline } from '@/lib/deadlines/types'

const deadline = (overrides: Record<string, unknown>) => ({
  estimated: false,
  projected: false,
  ...overrides,
})

const VIEW = {
  today: '2026-05-10',
  fiscalYear: { id: 'fy-2026', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false },
  deadlines: [
    deadline({ id: 'cfe:2025', date: '2026-04-15', legalDate: '2026-04-15', label: 'Solde de CFE 2025', form: 'CFE', category: 'cfe', ruleId: 'cfe' }),
    deadline({ id: 'tva-ca3:2026-04', date: '2026-05-07', legalDate: '2026-05-07', label: "Déclaration de TVA d'avril 2026", form: 'CA3', category: 'tva', ruleId: 'tva-ca3', estimated: true }),
    deadline({
      id: 'is-acompte:2026-12-31:2',
      date: '2026-05-15',
      legalDate: '2026-05-15',
      label: "Deuxième acompte d'IS",
      form: '2571',
      category: 'is',
      ruleId: 'is-acompte',
      condition: "Si l'IS de l'exercice précédent dépasse 3 000 €",
    }),
    deadline({ id: 'liasse:2025-12-31', date: '2026-06-01', legalDate: '2026-05-30', label: 'Liasse fiscale 2025', form: '2065', category: 'liasse', ruleId: 'liasse', extendedDate: '2026-06-16', projected: true }),
  ],
  rules: [
    { id: 'liasse', category: 'liasse', form: '2065', summary: "Le 2e jour ouvré suivant le 1er mai pour un exercice clos le 31 décembre.", sources: [{ label: 'CGI, art. 223', url: 'https://www.legifrance.gouv.fr/' }] },
  ],
  settings: {},
  missingRegimes: false,
}

let view: unknown
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  view = VIEW
  fetchMock = vi.fn(async () => respond(200, view))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const statusOf = (label: string) => {
  const item = screen.getByText(label).closest('li') as HTMLElement
  return within(item).getAllByText(/aujourd'hui|demain|dans \d+ jours|en retard de \d+ jours?|passée/)[0].textContent
}

describe('deadlines page', () => {
  it('lets the server pick the fiscal year, then groups the deadlines by month with how far each one is', async () => {
    render(<DeadlinesPage companyId="c1" />)
    expect(await screen.findByRole('list', { name: 'Échéances de mai 2026' })).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/deadlines?companyId=c1')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Avril 2026', 'Mai 2026', 'Juin 2026'])
    // 25 days late: past, not alarming; 3 days late: overdue; 5 days ahead
    expect(statusOf('Solde de CFE 2025')).toBe('passée')
    expect(statusOf("Déclaration de TVA d'avril 2026")).toBe('en retard de 3 jours')
    expect(statusOf("Deuxième acompte d'IS")).toBe('dans 5 jours')
    expect(screen.getByText("Si l'IS de l'exercice précédent dépasse 3 000 €")).toBeInTheDocument()
    expect(screen.getByText("Télédéclaration possible jusqu'au 16/06/2026.")).toBeInTheDocument()
    // The CA3 day is unknown: shown as indicative, with the notice to fill it in
    expect(within(screen.getByText("Déclaration de TVA d'avril 2026").closest('li') as HTMLElement).getByText('Jour indicatif')).toBeInTheDocument()
    expect(within(screen.getByText('Liasse fiscale 2025').closest('li') as HTMLElement).getByText('Exercice prévisionnel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Indiquer le jour' })).toHaveAttribute('href', '/c1/informations#echeances')
  })

  it('filters by category and says when a category has nothing on the year', async () => {
    const user = userEvent.setup()
    render(<DeadlinesPage companyId="c1" />)
    await screen.findByRole('list', { name: 'Échéances de mai 2026' })
    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'IS' }))
    expect(screen.getByText("Deuxième acompte d'IS")).toBeInTheDocument()
    expect(screen.queryByText('Solde de CFE 2025')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Mai 2026'])

    await user.click(screen.getByRole('combobox', { name: 'Catégorie' }))
    await user.click(await screen.findByRole('option', { name: 'Juridique' }))
    expect(screen.getByText('Aucune échéance Juridique sur cet exercice')).toBeInTheDocument()
  })

  it('shows the rule and its source, and the legal date before postponement', async () => {
    const user = userEvent.setup()
    render(<DeadlinesPage companyId="c1" />)
    await user.click(await screen.findByRole('button', { name: "Source de l'échéance Liasse fiscale 2025" }))
    expect(await screen.findByText("Le 2e jour ouvré suivant le 1er mai pour un exercice clos le 31 décembre.")).toBeInTheDocument()
    expect(screen.getByText(/Date légale le .*30 mai 2026.*, reportée au jour ouvré suivant\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CGI, art\. 223/ })).toHaveAttribute('href', 'https://www.legifrance.gouv.fr/')
    // A deadline without a known rule has no source button
    expect(screen.queryByRole('button', { name: "Source de l'échéance Solde de CFE 2025" })).not.toBeInTheDocument()
  })

  it('shows the error of the API and loads again on request', async () => {
    fetchMock.mockResolvedValueOnce(respond(500, { error: 'Les échéances ne se sont pas calculées.' }))
    const user = userEvent.setup()
    render(<DeadlinesPage companyId="c1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Les échéances ne se sont pas calculées.')
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('list', { name: 'Échéances de mai 2026' })).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('asks for a first fiscal year, and for the regimes when they are missing', async () => {
    view = { ...VIEW, fiscalYear: null, deadlines: [], missingRegimes: true }
    render(<DeadlinesPage companyId="c1" />)
    expect(await screen.findByText('Aucun exercice pour cette société')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Créer un exercice' })).toHaveAttribute('href', '/c1/fiscal-years')
    expect(screen.getByRole('link', { name: 'Renseigner les régimes' })).toHaveAttribute('href', '/c1/informations#regimes-fiscaux')
  })

  it('links a VAT deadline to the preparation of its return', async () => {
    render(<DeadlinesPage companyId="c1" />)
    const item = (await screen.findByText("Déclaration de TVA d'avril 2026")).closest('li') as HTMLElement
    expect(within(item).getByRole('link', { name: /Préparer la déclaration/ })).toHaveAttribute('href', '/c1/declarations-tva?periode=2026-04')
    const cfe = screen.getByText('Solde de CFE 2025').closest('li') as HTMLElement
    expect(within(cfe).queryByRole('link', { name: /Préparer la déclaration/ })).not.toBeInTheDocument()
  })

  it('links the IS deadlines to the corporate tax worksheet that computes them', async () => {
    render(<DeadlinesPage companyId="c1" />)
    const acompte = (await screen.findByText("Deuxième acompte d'IS")).closest('li') as HTMLElement
    expect(within(acompte).getByRole('link', { name: /Voir le calcul de l’acompte/ })).toHaveAttribute('href', '/c1/impot-societes?echeance=is-acompte%3A2026-12-31%3A2')
    const liasse = screen.getByText('Liasse fiscale 2025').closest('li') as HTMLElement
    expect(within(liasse).getByRole('link', { name: /Préparer le résultat fiscal/ })).toHaveAttribute('href', '/c1/impot-societes?echeance=liasse%3A2025-12-31')
    const cfe = screen.getByText('Solde de CFE 2025').closest('li') as HTMLElement
    expect(within(cfe).queryByRole('link', { name: /impôt sur|résultat fiscal|acompte/ })).not.toBeInTheDocument()
    // A CFE deadline opens the local taxes of its year instead
    expect(within(cfe).getByRole('link', { name: /Voir les impôts locaux/ })).toHaveAttribute('href', '/c1/impots-locaux?annee=2025')
  })

  it('shows the status of each deadline and records a payment from the calendar (tracker)', async () => {
    const withStatus = (d: Deadline, record: Parameters<typeof deriveStatus>[2] = null) => ({ ...d, status: deriveStatus(d, null, record, '2026-05-10') })
    const cfe = VIEW.deadlines[0] as unknown as Deadline
    const acompte = VIEW.deadlines[2] as unknown as Deadline
    const paid = { filedOn: null, paidOn: '2026-05-09', amountCents: 150_000, notDue: false, attachmentId: null, attachmentName: null, attachmentReference: 'Télépaiement 4321', note: null, updatedAt: null }
    view = { ...VIEW, deadlines: [withStatus(cfe), VIEW.deadlines[1], withStatus(acompte, paid), VIEW.deadlines[3]] }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { deadlineId: string; paidOn: string }
        expect(body).toMatchObject({ deadlineId: 'cfe:2025', paidOn: '2026-04-14', amountCents: 98_000, attachmentReference: 'Avis 2025' })
        return respond(200, withStatus(cfe, { ...paid, paidOn: body.paidOn, amountCents: 98_000, attachmentReference: 'Avis 2025' }))
      }
      return respond(200, String(url).startsWith('/api/expense-reports/receipts') ? { receipts: [] } : view)
    })
    const user = userEvent.setup()
    render(<DeadlinesPage companyId="c1" />)
    const acompteItem = (await screen.findByText("Deuxième acompte d'IS")).closest('li') as HTMLElement
    expect(within(acompteItem).getAllByText('Payée')[0].closest('[data-tone]')).toHaveAttribute('data-tone', 'success')
    expect(within(acompteItem).getByText(/Payée le 09\/05\/2026, 1.500,00.€, réf\. Télépaiement 4321/)).toBeInTheDocument()
    const cfeItem = screen.getByText('Solde de CFE 2025').closest('li') as HTMLElement
    expect(within(cfeItem).getAllByText('En retard')[0].closest('[data-tone]')).toHaveAttribute('data-tone', 'danger')

    // Only the overdue ones
    await user.click(screen.getByRole('combobox', { name: 'Statut' }))
    await user.click(await screen.findByRole('option', { name: 'En retard' }))
    expect(screen.queryByText("Deuxième acompte d'IS")).not.toBeInTheDocument()
    expect(screen.getByText('Solde de CFE 2025')).toBeInTheDocument()

    await user.click(within(screen.getByText('Solde de CFE 2025').closest('li') as HTMLElement).getByRole('button', { name: /Enregistrer le dépôt ou le paiement/ }))
    const dialog = await screen.findByRole('dialog')
    // A payment: no filing date to enter
    expect(within(dialog).queryByLabelText('Déposée le')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Payée le'), '14/04/2026')
    await user.type(within(dialog).getByLabelText(/Montant/), '980')
    await user.type(within(dialog).getByLabelText(/Référence de la pièce/), 'Avis 2025')
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Paid now: no longer in the overdue filter, shown again with every status
    expect(screen.queryByText('Solde de CFE 2025')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Statut' }))
    await user.click(await screen.findByRole('option', { name: 'Tous les statuts' }))
    expect(within(screen.getByText('Solde de CFE 2025').closest('li') as HTMLElement).getByText(/Payée le 14\/04\/2026/)).toBeInTheDocument()
  })
})
