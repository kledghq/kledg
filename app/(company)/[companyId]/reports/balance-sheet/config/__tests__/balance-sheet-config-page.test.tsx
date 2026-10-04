/**
 * Configuration du bilan page: the variant it edits (complete 2050 or
 * simplified 2033-A layout), saving every line of the tree (children
 * included) with PATCH, deleting a line, and resetting the variant to the
 * PCG model after confirmation. fetch is mocked; the nested editor is a stub
 * (it has its own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/balance-sheet/config',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type Line = { id: string; lineLabel: string; children?: Line[] } & Record<string, unknown>
vi.mock('@/components/features/reports/balance-sheet-nested-config-editor', () => ({
  BalanceSheetNestedConfigEditor: ({ configs, onSave, onDelete }: { configs: Line[]; onSave: (c: Line[]) => void; onDelete: (id: string) => void }) => (
    <div>
      <p>{configs.map((c) => c.lineLabel).join(', ')}</p>
      <button type="button" onClick={() => onSave(configs)}>
        Enregistrer la configuration
      </button>
      <button type="button" onClick={() => onDelete('l-stocks')}>
        Supprimer Stocks
      </button>
    </div>
  ),
}))

import { toast } from 'sonner'
import BalanceSheetConfigPage from '../page'

const line = (id: string, lineLabel: string, extra: Record<string, unknown> = {}): Line => ({
  id,
  lineLabel,
  section: 'actif',
  lineType: 'line',
  formCode: null,
  accountCodes: [],
  filterType: 'starts_with',
  filterValue: null,
  balanceType: 'debit',
  displayType: 'net',
  hideLabel: false,
  order: 0,
  notes: null,
  reportVariant: 'complete',
  ...extra,
})

const CONFIG = {
  lines: [
    line('l-actif-circulant', 'Actif circulant', {
      lineType: 'section',
      children: [
        line('l-stocks', 'Stocks', { formCode: 'BL', accountCodes: ['31', '37'], amortissementAccountCodes: ['391'], order: 1 }),
        line('l-dispo', 'Disponibilités', { formCode: 'CF', accountCodes: ['512', '53'], order: 2 }),
      ],
    }),
  ],
}

let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/companies/c1/balance-sheet/config') return respond(200, CONFIG)
    if (key.startsWith('PATCH /api/companies/c1/balance-sheet/config/line/')) return respond(200, {})
    return respond(404, { error: `unexpected ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const sent = (method: string) => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method)
const configQueries = () =>
  sent('GET')
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/companies/c1/balance-sheet/config')
    .map((url) => url.searchParams.get('variant'))

describe('balance sheet configuration page', () => {
  it('edits the complete layout by default, and the simplified one when chosen in the labelled field', async () => {
    const user = userEvent.setup()
    render(<BalanceSheetConfigPage />)
    expect(await screen.findByText('Actif circulant')).toBeInTheDocument()
    expect(configQueries()).toEqual(['complete'])
    await user.click(screen.getByRole('combobox', { name: 'Variante' }))
    await user.click(await screen.findByRole('option', { name: 'Simplifiée' }))
    await waitFor(() => expect(configQueries()).toEqual(['complete', 'simplified']))
  })

  it('saves every line of the tree, children included, with their account codes', async () => {
    const user = userEvent.setup()
    render(<BalanceSheetConfigPage />)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer la configuration' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Configuration enregistrée'))
    const patches = sent('PATCH')
    expect(patches.map(([input]) => String(input))).toEqual([
      '/api/companies/c1/balance-sheet/config/line/l-actif-circulant',
      '/api/companies/c1/balance-sheet/config/line/l-stocks',
      '/api/companies/c1/balance-sheet/config/line/l-dispo',
    ])
    // Stocks: 31 and 37 gross, 391 depreciation (2050 line BL)
    expect(JSON.parse(String(patches[1][1]?.body))).toMatchObject({
      lineLabel: 'Stocks',
      formCode: 'BL',
      accountCodes: ['31', '37'],
      amortissementAccountCodes: ['391'],
      excludedAccountCodes: [],
      amortissementFormCode: null,
    })
    // Reloaded after saving
    expect(configQueries()).toEqual(['complete', 'complete'])
  })

  it('stops at the first refused line and shows why', async () => {
    replies['PATCH /api/companies/c1/balance-sheet/config/line/l-stocks'] = { status: 400, body: { error: 'Le compte 6 ne peut pas alimenter le bilan' } }
    const user = userEvent.setup()
    render(<BalanceSheetConfigPage />)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer la configuration' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le compte 6 ne peut pas alimenter le bilan'))
    expect(sent('PATCH')).toHaveLength(2)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('deletes a line and reloads the layout', async () => {
    replies['DELETE /api/companies/c1/balance-sheet/config/line/l-stocks'] = { body: { ok: true } }
    const user = userEvent.setup()
    render(<BalanceSheetConfigPage />)
    await user.click(await screen.findByRole('button', { name: 'Supprimer Stocks' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ligne supprimée'))
    expect(configQueries()).toEqual(['complete', 'complete'])
  })

  it('resets the variant to the PCG model only after confirmation', async () => {
    replies['POST /api/companies/c1/balance-sheet/config/default'] = { body: CONFIG }
    const user = userEvent.setup()
    render(<BalanceSheetConfigPage />)
    await user.click(await screen.findByRole('button', { name: /Réinitialiser/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/variante complète reviennent au modèle du PCG/)).toBeInTheDocument()
    expect(sent('POST')).toHaveLength(0)
    await user.click(within(confirm).getByRole('button', { name: 'Réinitialiser' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Configuration réinitialisée'))
    expect(JSON.parse(String(sent('POST')[0][1]?.body))).toEqual({ variant: 'complete' })
  })
})
