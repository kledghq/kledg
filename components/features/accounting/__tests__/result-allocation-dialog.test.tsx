import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResultAllocationDialog } from '../result-allocation-dialog'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const COMPANY = 'co-1'
const FY = { id: 'fy-2025', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' }
const BASE = `/api/companies/${COMPANY}/fiscal-years/${FY.id}/result-allocation`

const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

interface Plan {
  result: number
  legalReserveRequired: boolean
  legalReserve: number
  distributable: number
  dividends: number
  otherReserves: number
  priorLossesCleared: number
  retainedEarnings: number
  lines: Array<{ code: string; debit: number; credit: number }>
  errors: string[]
}

/**
 * Plan the server returns (lib/accounting/result-allocation) for a profit of
 * 20 000 EUR in a SARL with capital 10 000 EUR and no legal reserve yet:
 * Code de commerce art. L232-10 takes 5 % of the profit (1 000 EUR, below the
 * 10 % of capital ceiling); the distributable profit (art. L232-11) is
 * 20 000 - 1 000 = 19 000 EUR; the rest goes to report à nouveau.
 */
function planFor(dividends: number, otherReserves: number, overrides: Partial<Plan> = {}): Plan {
  const retained = 19000 - dividends - otherReserves
  return {
    result: 20000,
    legalReserveRequired: true,
    legalReserve: 1000,
    distributable: 19000,
    dividends,
    otherReserves,
    priorLossesCleared: 0,
    retainedEarnings: retained,
    lines: [],
    errors: retained < 0 ? ['Les dividendes et réserves dépassent le bénéfice distribuable (19 000,00 €).'] : [],
    ...overrides,
  }
}

const json = (data: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => data }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

function installFetch(opts: { plan?: (d: number, o: number) => Plan; post?: Response } = {}) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString(), 'http://localhost')
    if (url.pathname === BASE && init?.method === 'POST') return opts.post ?? json({ entryNumber: 'OD-42' })
    if (url.pathname === BASE) {
      const d = Number(url.searchParams.get('dividends'))
      const o = Number(url.searchParams.get('otherReserves'))
      return json({ plan: (opts.plan ?? planFor)(d, o) })
    }
    return json({}, false)
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderDialog() {
  const onOpenChange = vi.fn()
  const onDone = vi.fn()
  render(<ResultAllocationDialog companyId={COMPANY} fiscalYear={FY} open onOpenChange={onOpenChange} onDone={onDone} />)
  return { onOpenChange, onDone, user: userEvent.setup() }
}

/** Amount fields start at "0,00": clear them before typing, as a user does. */
async function retype(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  const field = screen.getByLabelText(label)
  expect(field).toHaveValue('0,00')
  await user.clear(field)
  await user.type(field, text)
}

/** The "label  amount" rows of the plan summary. */
function summaryRow(label: RegExp): string {
  return norm(screen.getByText(label).parentElement?.textContent)
}

describe('ResultAllocationDialog', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("previews the allocation of the previous year's profit, legal reserve first", async () => {
    installFetch()
    renderDialog()

    expect(screen.getByRole('heading', { name: 'Affecter le résultat 2024' })).toBeInTheDocument()
    expect(await screen.findByText('Bénéfice à affecter (120)')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}?dividends=0&otherReserves=0`, expect.anything())
    expect(summaryRow(/^Bénéfice à affecter/)).toBe('Bénéfice à affecter (120)20 000,00 €')
    expect(summaryRow(/^Réserve légale/)).toBe('Réserve légale (1061)1 000,00 €')
    expect(summaryRow(/^Dividendes \(457\)/)).toBe('Dividendes (457)0,00 €')
    expect(summaryRow(/^Report à nouveau/)).toBe('Report à nouveau (110)19 000,00 €')
    expect(norm(screen.getByText(/Bénéfice distribuable/).textContent)).toBe('Bénéfice distribuable : 19 000,00 €')
    // The general meeting defaults to 30 June of the open year.
    expect(screen.getByLabelText("Date de l'assemblée")).toHaveValue('30/06/2025')
  })

  it('recomputes the plan with the dividends in euros and books the allocation', async () => {
    installFetch()
    const { onOpenChange, onDone, user } = renderDialog()
    await screen.findByText('Bénéfice à affecter (120)')

    await retype(user, 'Dividendes', '12 000,50')
    await waitFor(() => expect(summaryRow(/^Report à nouveau/)).toBe('Report à nouveau (110)6 999,50 €'))
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}?dividends=12000.5&otherReserves=0`, expect.anything())

    await retype(user, 'Autres réserves', '2000')
    await waitFor(() => expect(summaryRow(/^Autres réserves \(1068\)/)).toBe('Autres réserves (1068)2 000,00 €'))

    await user.click(screen.getByRole('button', { name: 'Affecter le résultat' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe(BASE)
    expect(JSON.parse(String(post[1]?.body))).toEqual({ date: '2025-06-30', dividends: 12000.5, otherReserves: 2000 })
    expect(toast.success).toHaveBeenCalledWith('Résultat affecté : écriture n° OD-42')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('blocks the booking while the plan has errors', async () => {
    installFetch()
    const { user } = renderDialog()
    await screen.findByText('Bénéfice à affecter (120)')

    await retype(user, 'Dividendes', '25000')

    expect(
      await screen.findByText('Les dividendes et réserves dépassent le bénéfice distribuable (19 000,00 €).')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Affecter le résultat' })).toBeDisabled()
  })

  it('blocks the booking while an amount is not a number', async () => {
    installFetch()
    const { user } = renderDialog()
    await screen.findByText('Bénéfice à affecter (120)')
    await retype(user, 'Dividendes', 'abc')
    expect(screen.getByRole('button', { name: 'Affecter le résultat' })).toBeDisabled()
  })

  it('says when the legal reserve does not apply to the legal form, and shows prior losses cleared', async () => {
    installFetch({
      plan: () =>
        planFor(0, 0, { legalReserveRequired: false, legalReserve: 0, priorLossesCleared: 3000, retainedEarnings: 17000 }),
    })
    renderDialog()
    await screen.findByText('Bénéfice à affecter (120)')
    expect(summaryRow(/^Réserve légale/)).toBe('Réserve légale (1061) : non obligatoire pour cette forme0,00 €')
    expect(summaryRow(/^Apurement du report/)).toBe('Apurement du report à nouveau débiteur (119)3 000,00 €')
  })

  it('carries a loss forward to 119', async () => {
    installFetch({
      plan: () => ({
        ...planFor(0, 0),
        result: -4500,
        legalReserve: 0,
        distributable: 0,
        retainedEarnings: -4500,
      }),
    })
    renderDialog()
    expect(await screen.findByText('Perte à reporter (129)')).toBeInTheDocument()
    expect(summaryRow(/^Perte à reporter/)).toBe('Perte à reporter (129)-4 500,00 €')
    expect(summaryRow(/^Report à nouveau/)).toBe('Report à nouveau (119)-4 500,00 €')
    expect(screen.queryByText(/Réserve légale \(1061\)/)).not.toBeInTheDocument()
  })

  it('shows only the explanation when there is no result to allocate', async () => {
    installFetch({
      plan: () => ({ ...planFor(0, 0), result: 0, errors: ["Le résultat de l'exercice 2024 est nul : rien à affecter."] }),
    })
    renderDialog()
    expect(await screen.findByText("Le résultat de l'exercice 2024 est nul : rien à affecter.")).toBeInTheDocument()
    expect(screen.queryByText(/Report à nouveau/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Affecter le résultat' })).toBeDisabled()
  })

  it('shows the API error and keeps the dialog open', async () => {
    installFetch({ post: json({ error: 'Le résultat 2024 est déjà affecté.' }, false) })
    const { onDone, onOpenChange, user } = renderDialog()
    await screen.findByText('Bénéfice à affecter (120)')

    await user.click(screen.getByRole('button', { name: 'Affecter le résultat' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le résultat 2024 est déjà affecté.'))
    expect(onDone).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
