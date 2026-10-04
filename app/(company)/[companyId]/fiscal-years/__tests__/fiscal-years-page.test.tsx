/**
 * Fiscal years page: the dates it proposes for a new fiscal year, and the
 * closing flow (simulation first, then the definitive closing). fetch is
 * mocked; the requests the page sends are asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/fiscal-years',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import FiscalYearsPage from '../page'

interface Company {
  name: string
  closingDay: number | null
  closingMonth: number | null
  foundationDate: string | null
  fiscalYears: Array<{ id: string; year: number; startDate: string; endDate: string; isClosed: boolean; closingDay: number | null; closingMonth: number | null }>
}

type Reply = { status?: number; body: unknown }
let company: Company
let replies: Record<string, Reply>
let fetchMock: ReturnType<typeof vi.fn>

function json(reply: Reply) {
  return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  // Date only: the year proposed by default is the current one (2026, a common year)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T10:00:00Z'))
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const key = `${method} ${url}`
    if (replies[key]) return json(replies[key])
    if (key === 'GET /api/companies/c1') return json({ body: company })
    if (url.startsWith('/api/companies/c1/opening-balances')) return json({ body: { needed: false } })
    return json({ status: 404, body: { error: `unexpected ${key}` } })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const fy2025 = { id: 'fy-2025', year: 2025, startDate: '2025-01-01T00:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z', isClosed: false, closingDay: 31, closingMonth: 12 }

function sentBody(method: string, url: string) {
  const call = fetchMock.mock.calls.find(([input, init]) => String(input) === url && (init?.method ?? 'GET') === method)
  return call ? JSON.parse(String(call[1]?.body)) : undefined
}

async function createWithDefaults() {
  const user = userEvent.setup()
  render(<FiscalYearsPage />)
  await user.click((await screen.findAllByRole('button', { name: /Ajouter un exercice/ }))[0])
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Créer' }))
  await waitFor(() => expect(sentBody('POST', '/api/companies/c1/fiscal-years')).toBeDefined())
  return sentBody('POST', '/api/companies/c1/fiscal-years')
}

describe('fiscal years page: dates proposed for a new fiscal year', () => {
  it('proposes the calendar year for a 31 December closing (Code de commerce art. L123-12: 12-month fiscal year)', async () => {
    company = { name: 'Atelier', closingDay: 31, closingMonth: 12, foundationDate: '2020-05-01T00:00:00.000Z', fiscalYears: [fy2025] }
    expect(await createWithDefaults()).toEqual({ year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' })
  })

  it('runs from the day after the previous closing to the closing day for a 30 June closing', async () => {
    company = { name: 'Atelier', closingDay: 30, closingMonth: 6, foundationDate: null, fiscalYears: [fy2025] }
    expect(await createWithDefaults()).toEqual({ year: 2026, startDate: '2025-07-01', endDate: '2026-06-30' })
  })

  it('clamps a 29 February closing to 28 February in a common year, never 1 March', async () => {
    company = { name: 'Atelier', closingDay: 29, closingMonth: 2, foundationDate: null, fiscalYears: [fy2025] }
    expect(await createWithDefaults()).toEqual({ year: 2026, startDate: '2025-03-01', endDate: '2026-02-28' })
  })

  it('starts the first fiscal year at the foundation date of the company', async () => {
    company = { name: 'Atelier', closingDay: 31, closingMonth: 12, foundationDate: '2026-03-15T00:00:00.000Z', fiscalYears: [] }
    expect(await createWithDefaults()).toEqual({ year: 2026, startDate: '2026-03-15', endDate: '2026-12-31' })
  })

  it('shows the error of the API and keeps the dialog open', async () => {
    company = { name: 'Atelier', closingDay: 31, closingMonth: 12, foundationDate: null, fiscalYears: [fy2025] }
    replies['POST /api/companies/c1/fiscal-years'] = { status: 409, body: { error: "Un exercice pour l'année 2026 existe déjà" } }
    await createWithDefaults()
    expect(await screen.findByText("Un exercice pour l'année 2026 existe déjà")).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('fiscal years page: closing', () => {
  beforeEach(() => {
    company = { name: 'Atelier', closingDay: 31, closingMonth: 12, foundationDate: null, fiscalYears: [fy2025] }
  })

  it('shows the simulation, then closes and reports the result', async () => {
    replies['GET /api/companies/c1/fiscal-years/fy-2025/close/simulate'] = {
      body: {
        warnings: ['2 écritures en brouillon seront ignorées'],
        nextFiscalYear: { year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
        closingEntries: { result: { amount: 1500, accountCode: '120', accountLabel: 'Résultat de l’exercice (bénéfice)' }, incomeStatement: { accountsToClose: 3 } },
        accountsToCreate: 0,
        accountsPreview: [],
        openingEntries: { entryCount: 1, totalLines: 2, accountsWithBalance: 2, totalDebit: 1500, totalCredit: 1500, preview: [] },
      },
    }
    replies['POST /api/companies/c1/fiscal-years/fy-2025/close'] = { body: { result: 1500 } }
    const user = userEvent.setup()
    render(<FiscalYearsPage />)
    await user.click((await screen.findAllByRole('button', { name: 'Clôturer' }))[0])

    const dialog = await screen.findByRole('alertdialog')
    // PCG art. 941-12: the result goes to 120 (profit) until the shareholders allocate it
    expect(await within(dialog).findByText(/porté au compte/)).toHaveTextContent('120')
    expect(within(dialog).getByText('2 écritures en brouillon seront ignorées')).toBeInTheDocument()
    expect(within(dialog).getByText(/1 écriture d'ouverture de 2 lignes, pour 2 comptes de bilan/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Confirmer la clôture' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Exercice clôturé : résultat de 1 500,00 €'))
    expect(fetchMock.mock.calls.some(([u, init]) => String(u) === '/api/companies/c1/fiscal-years/fy-2025/close' && init?.method === 'POST')).toBe(true)
  })

  it('lists what blocks the closing when the simulation refuses it', async () => {
    replies['GET /api/companies/c1/fiscal-years/fy-2025/close/simulate'] = {
      status: 400,
      body: { error: 'Clôture impossible', details: ["L'écriture 12 n'est pas équilibrée", 'Le compte 471 a un solde'] },
    }
    const user = userEvent.setup()
    render(<FiscalYearsPage />)
    await user.click((await screen.findAllByRole('button', { name: 'Clôturer' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    expect(await within(dialog).findByText('Ces points bloquent la clôture', { exact: false })).toBeInTheDocument()
    expect(within(dialog).getByText("L'écriture 12 n'est pas équilibrée")).toBeInTheDocument()
    expect(within(dialog).getByText('Le compte 471 a un solde')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Confirmer la clôture' })).toBeDisabled()
    expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith('/close') && init?.method === 'POST')).toBe(false)
  })
})
