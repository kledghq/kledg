import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DepreciationDetailDialog } from '../depreciation-detail-dialog'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ASSET = 'fa-1'
const COMPANY = 'co-1'
const STATUS_URL = `/api/fixed-assets/${ASSET}/depreciation-status?companyId=${COMPANY}`

const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

type Month = {
  monthIndex: number
  calendarYear: number
  monthStart: string
  monthEnd: string
  suggestedAmount: number
  posted: { id: string; amount: number; note: string | null; accountingEntry: { id: string; entryNumber: string; date: string } | null } | null
}

function months(year: number, amount: number): Month[] {
  return Array.from({ length: 12 }, (_, i) => ({
    monthIndex: i,
    calendarYear: year,
    monthStart: `${year}-${String(i + 1).padStart(2, '0')}-01`,
    monthEnd: `${year}-${String(i + 1).padStart(2, '0')}-28`,
    suggestedAmount: amount,
    posted: null,
  }))
}

function fiscalYear(year: number, overrides: Record<string, unknown> = {}) {
  return {
    fiscalYearId: `fy-${year}`,
    year,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    isClosed: false,
    entriesCount: 0,
    postedAmount: 0,
    suggestedAmount: 1200,
    done: false,
    entries: [],
    months: months(year, 100),
    yearlyRecord: null,
    ...overrides,
  }
}

function status(fiscalYears: unknown[]) {
  return {
    baseAmount: 3600,
    totalPosted: 1200,
    remainingCapacity: 2400,
    depreciationMethod: 'linear',
    depreciationStartDate: '2024-01-01',
    fiscalYears,
  }
}

type Handler = (url: string, init?: RequestInit) => Response | undefined

const json = (data: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => data }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>

function installFetch(statusData: unknown, handler: Handler = () => undefined) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    const custom = handler(url, init)
    if (custom) return custom
    if (url === STATUS_URL) return json(statusData)
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

/** Non GET calls, as [url, method, parsed body]. */
function writes() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== 'GET')
    .map(([url, init]) => [url.toString(), init?.method, init?.body ? JSON.parse(String(init.body)) : undefined])
}

function renderDialog(onChanged = vi.fn()) {
  render(
    <DepreciationDetailDialog
      open
      onOpenChange={vi.fn()}
      assetId={ASSET}
      companyId={COMPANY}
      assetLabel="Mac Studio"
      onChanged={onChanged}
    />
  )
  return { onChanged, user: userEvent.setup() }
}

function yearRow(year: number): HTMLElement {
  return screen.getByText(`Exercice ${year}`).closest('tr') as HTMLElement
}

describe('DepreciationDetailDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    vi.mocked(toast.info).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads the plan, shows the summary and opens the fiscal year containing today', async () => {
    installFetch(status([fiscalYear(2024), fiscalYear(2025)]))
    renderDialog()

    expect(await screen.findByText('Exercice 2024')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(STATUS_URL)
    expect(screen.getByRole('heading', { name: 'Amortissements, Mac Studio' })).toBeInTheDocument()

    const summary = screen.getByText('Base amortissable').parentElement!.parentElement!
    expect(norm(summary.textContent)).toBe(
      'Base amortissable3 600,00 €Cumul amorti1 200,00 €Reste à amortir2 400,00 €MéthodeLinéaire'
    )

    // 2025 contains 15 June 2025: expanded with its twelve months, 2024 folded.
    expect(screen.getByRole('button', { name: "Replier l'exercice 2025" })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: "Déplier l'exercice 2024" })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('juin 2025')).toBeInTheDocument()
    expect(screen.queryByText('juin 2024')).not.toBeInTheDocument()
    expect(norm(within(yearRow(2024)).getAllByRole('cell')[2].textContent)).toBe('1 200,00 €')
  })

  it('posts the suggested annuity, then generates its entry', async () => {
    installFetch(status([fiscalYear(2024)]), (url, init) => {
      if (url === `/api/fixed-assets/${ASSET}/depreciation` && init?.method === 'POST') {
        return json({ id: 'rec-1', accountingEntryId: null })
      }
      return undefined
    })
    const { onChanged, user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.click(within(yearRow(2024)).getByRole('button', { name: 'Amortir' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Amortissement enregistré + écriture générée'))
    expect(writes()).toEqual([
      [
        `/api/fixed-assets/${ASSET}/depreciation`,
        'POST',
        { companyId: COMPANY, fiscalYearId: 'fy-2024', periodType: 'year', amount: 1200 },
      ],
      [`/api/fixed-assets/${ASSET}/depreciation/rec-1/post`, 'POST', { companyId: COMPANY }],
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)
    // The plan is reloaded after the posting.
    expect(fetchMock.mock.calls.filter(([u]) => u === STATUS_URL)).toHaveLength(2)
  })

  it('posts the amount typed by the user for a month, and skips the entry when one is already linked', async () => {
    installFetch(status([fiscalYear(2025)]), (url, init) => {
      if (url === `/api/fixed-assets/${ASSET}/depreciation` && init?.method === 'POST') {
        return json({ id: 'rec-9', accountingEntryId: 'entry-1' })
      }
      return undefined
    })
    const { user } = renderDialog()
    const row = (await screen.findByText('mars 2025')).closest('tr') as HTMLElement

    await user.type(within(row).getByRole('spinbutton'), '87.5')
    await user.click(within(row).getByRole('button', { name: 'Amortir' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(writes()).toEqual([
      [
        `/api/fixed-assets/${ASSET}/depreciation`,
        'POST',
        { companyId: COMPANY, fiscalYearId: 'fy-2025', periodType: 'month', monthIndex: 2, amount: 87.5 },
      ],
    ])
  })

  it('refuses a zero amount without calling the API', async () => {
    installFetch(status([fiscalYear(2024)]))
    const { user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.type(within(yearRow(2024)).getByRole('spinbutton'), '0')
    await user.click(within(yearRow(2024)).getByRole('button', { name: 'Amortir' }))

    expect(toast.error).toHaveBeenCalledWith('Montant invalide')
    expect(writes()).toEqual([])
  })

  it('shows the API error when the amount cannot be saved', async () => {
    installFetch(status([fiscalYear(2024)]), (url, init) =>
      init?.method === 'POST' ? json({ error: 'Exercice clôturé' }, false) : undefined
    )
    const { onChanged, user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.click(within(yearRow(2024)).getByRole('button', { name: 'Amortir' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Exercice clôturé'))
    expect(writes()).toHaveLength(1)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('says the value is saved but not posted when the entry generation fails', async () => {
    installFetch(status([fiscalYear(2024)]), (url, init) => {
      if (url.endsWith('/post')) return json({}, false)
      if (init?.method === 'POST') return json({ id: 'rec-1', accountingEntryId: null })
      return undefined
    })
    const { onChanged, user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.click(within(yearRow(2024)).getByRole('button', { name: 'Amortir' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Valeur enregistrée mais écriture non générée'))
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('saves only the typed amounts of real fiscal years with "Enregistrer"', async () => {
    installFetch(
      status([fiscalYear(2024), fiscalYear(2025), fiscalYear(2026, { virtual: true })]),
      (url, init) => (init?.method === 'POST' ? json({ id: 'rec' }) : undefined)
    )
    const { user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(toast.info).toHaveBeenCalledWith('Rien à enregistrer')

    // The virtual fiscal year cannot be typed in.
    expect(within(yearRow(2026)).getByRole('spinbutton')).toBeDisabled()
    expect(within(yearRow(2026)).getByText("Créez l'exercice")).toBeInTheDocument()

    await user.type(within(yearRow(2024)).getByRole('spinbutton'), '1100')
    const april = screen.getByText('avril 2025').closest('tr') as HTMLElement
    await user.type(within(april).getByRole('spinbutton'), '90')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 amortissements enregistrés'))
    expect(writes()).toEqual([
      [`/api/fixed-assets/${ASSET}/depreciation`, 'POST', { companyId: COMPANY, fiscalYearId: 'fy-2024', periodType: 'year', amount: 1100 }],
      [
        `/api/fixed-assets/${ASSET}/depreciation`,
        'POST',
        { companyId: COMPANY, fiscalYearId: 'fy-2025', periodType: 'month', monthIndex: 3, amount: 90 },
      ],
    ])
  })

  it('reports failures of "Enregistrer"', async () => {
    installFetch(status([fiscalYear(2024)]), (url, init) => (init?.method === 'POST' ? json({}, false) : undefined))
    const { user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.type(within(yearRow(2024)).getByRole('spinbutton'), '1100')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("1 amortissement n'a pas pu être enregistré"))
  })

  describe('a posted annuity', () => {
    const linked = fiscalYear(2024, {
      entries: [{ id: 'rec-1', entryNumber: 'OD-12', date: '2024-12-31', amount: 1200, description: '', accountingEntry: null }],
      yearlyRecord: {
        id: 'rec-1',
        amount: 1200,
        note: null,
        accountingEntry: { id: 'entry-1', entryNumber: 'OD-12', date: '2024-12-31' },
      },
    })

    it('shows the amount and a link to its entry, and unlinks it', async () => {
      installFetch(status([linked]))
      const { onChanged, user } = renderDialog()
      await screen.findByText('Exercice 2024')
      const row = yearRow(2024)

      expect(norm(within(row).getAllByRole('cell')[3].textContent)).toContain('1 200,00 €')
      expect(within(row).getByRole('link', { name: 'OD-12' })).toHaveAttribute('href', `/${COMPANY}/entries/entry-1`)
      expect(within(row).queryByRole('button', { name: 'Amortir' })).not.toBeInTheDocument()

      await user.click(within(row).getByRole('button', { name: "Délier l'écriture" }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Écriture déliée'))
      expect(writes()).toEqual([
        [`/api/fixed-assets/${ASSET}/depreciation/rec-1`, 'PATCH', { companyId: COMPANY, accountingEntryId: null }],
      ])
      expect(onChanged).toHaveBeenCalledTimes(1)
    })

    it('deletes it after confirmation', async () => {
      installFetch(status([linked]))
      const { user } = renderDialog()
      await screen.findByText('Exercice 2024')

      await user.click(within(yearRow(2024)).getByRole('button', { name: "Supprimer l'amortissement" }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText('Supprimer cet amortissement ?')).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: "Supprimer l'amortissement" }))

      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Amortissement supprimé'))
      expect(fetchMock).toHaveBeenCalledWith(`/api/fixed-assets/${ASSET}/depreciation/rec-1?companyId=${COMPANY}`, {
        method: 'DELETE',
      })
    })

    it('lets the amount be edited again with the pencil', async () => {
      installFetch(status([linked]))
      const { user } = renderDialog()
      await screen.findByText('Exercice 2024')

      await user.click(within(yearRow(2024)).getByRole('button', { name: 'Modifier le montant' }))
      expect(within(yearRow(2024)).getByRole('spinbutton')).toHaveValue(1200)
    })
  })

  it('links an existing entry to a record without one', async () => {
    const unlinked = fiscalYear(2024, {
      entries: [{ id: 'rec-2', entryNumber: '', date: '2024-12-31', amount: 1200, description: '', accountingEntry: null }],
      yearlyRecord: { id: 'rec-2', amount: 1200, note: null, accountingEntry: null },
    })
    installFetch(status([unlinked]), (url) =>
      url === `/api/fixed-assets/${ASSET}/depreciation/rec-2/candidates?companyId=${COMPANY}`
        ? json({
            candidates: [
              {
                id: 'entry-7',
                entryNumber: 'OD-7',
                date: '2024-12-31',
                description: 'Dotation 2024',
                status: 'validated',
                total: 1200,
                looksLikeAmortization: true,
                alreadyLinkedCount: 0,
              },
              {
                id: 'entry-8',
                entryNumber: 'AC-3',
                date: '2024-05-02',
                description: 'Achat',
                status: 'draft',
                total: 50,
                looksLikeAmortization: false,
                alreadyLinkedCount: 2,
              },
            ],
          })
        : undefined
    )
    const { user } = renderDialog()
    await screen.findByText('Exercice 2024')

    await user.click(within(yearRow(2024)).getByRole('button', { name: /Lier/ }))
    const candidate = (await screen.findByText('OD-7')).closest('button') as HTMLElement
    expect(norm(candidate.textContent)).toContain('1 200,00 €')
    expect(within(candidate).getByText('Amortissement')).toBeInTheDocument()
    expect(screen.getByText('2 liens')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Filtrer par numéro ou libellé'), 'dotation')
    expect(screen.queryByText('AC-3')).not.toBeInTheDocument()

    await user.click(candidate)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Écriture liée'))
    expect(writes()).toEqual([
      [`/api/fixed-assets/${ASSET}/depreciation/rec-2`, 'PATCH', { companyId: COMPANY, accountingEntryId: 'entry-7' }],
    ])
  })

  it('tells the user to create a fiscal year when there is none', async () => {
    installFetch(status([]))
    renderDialog()
    expect(await screen.findByText(/Aucun exercice pour cette société/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  })

  it('shows the API error when the plan cannot be loaded', async () => {
    installFetch(null, (url) => (url === STATUS_URL ? json({ error: 'Immobilisation introuvable' }, false) : undefined))
    renderDialog()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Immobilisation introuvable'))
  })
})
