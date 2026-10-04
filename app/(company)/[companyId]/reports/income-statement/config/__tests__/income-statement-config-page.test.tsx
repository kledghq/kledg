/**
 * Configuration du compte de résultat page: the variant it edits (complete
 * 2052-2053 or simplified 2033-B layout), saving every line of the tree
 * (children included, with their parent) with PATCH, deleting a line, and
 * resetting the variant to the PCG model after confirmation. fetch is
 * mocked; the nested editor is a stub (it has its own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/reports/income-statement/config',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

type Line = { id: string; lineLabel: string; children?: Line[] } & Record<string, unknown>
vi.mock('@/components/features/reports/income-statement-nested-config-editor', () => ({
  IncomeStatementNestedConfigEditor: ({ configs, onSave, onDelete }: { configs: Line[]; onSave: (c: Line[]) => void; onDelete: (id: string) => void }) => (
    <div>
      <p>{configs.map((c) => c.lineLabel).join(', ')}</p>
      <button type="button" onClick={() => onSave(configs)}>
        Enregistrer la configuration
      </button>
      <button type="button" onClick={() => onDelete('l-stocks')}>
        Supprimer la ligne
      </button>
    </div>
  ),
}))

import { toast } from 'sonner'
import IncomeStatementConfigPage from '../page'

const line = (id: string, lineLabel: string, extra: Record<string, unknown> = {}): Line => ({
  id,
  lineLabel,
  parentId: null,
  section: 'charges',
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
    line('l-exploitation', "Charges d'exploitation", {
      lineType: 'section',
      children: [
        line('l-stocks', 'Autres achats et charges externes', { parentId: 'l-exploitation', formCode: 'FW', accountCodes: ['604', '61', '62'], order: 1 }),
        line('l-impots', 'Impôts, taxes et versements assimilés', { parentId: 'l-exploitation', formCode: 'FX', accountCodes: ['63'], order: 2 }),
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
    if (key === 'GET /api/companies/c1/income-statement/config') return respond(200, CONFIG)
    if (key.startsWith('PATCH /api/companies/c1/income-statement/config/line/')) return respond(200, {})
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
    .filter((url) => url.pathname === '/api/companies/c1/income-statement/config')
    .map((url) => url.searchParams.get('variant'))

describe('income statement configuration page', () => {
  it('edits the complete layout by default, and the simplified one when chosen in the labelled field', async () => {
    const user = userEvent.setup()
    render(<IncomeStatementConfigPage />)
    expect(await screen.findByText("Charges d'exploitation")).toBeInTheDocument()
    expect(configQueries()).toEqual(['complete'])
    await user.click(screen.getByRole('combobox', { name: 'Variante' }))
    await user.click(await screen.findByRole('option', { name: 'Simplifiée' }))
    await waitFor(() => expect(configQueries()).toEqual(['complete', 'simplified']))
  })

  it('saves every line of the tree, children included, with their account codes', async () => {
    const user = userEvent.setup()
    render(<IncomeStatementConfigPage />)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer la configuration' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Configuration enregistrée'))
    const patches = sent('PATCH')
    expect(patches.map(([input]) => String(input))).toEqual([
      '/api/companies/c1/income-statement/config/line/l-exploitation',
      '/api/companies/c1/income-statement/config/line/l-stocks',
      '/api/companies/c1/income-statement/config/line/l-impots',
    ])
    // 2052 line FW: 604, 61 and 62, under its section
    expect(JSON.parse(String(patches[1][1]?.body))).toMatchObject({
      parentId: 'l-exploitation',
      lineLabel: 'Autres achats et charges externes',
      formCode: 'FW',
      accountCodes: ['604', '61', '62'],
      excludedAccountCodes: [],
    })
    // Reloaded after saving
    expect(configQueries()).toEqual(['complete', 'complete'])
  })

  it('stops at the first refused line and shows why', async () => {
    replies['PATCH /api/companies/c1/income-statement/config/line/l-stocks'] = { status: 400, body: { error: 'Le compte 512 ne peut pas alimenter le compte de résultat' } }
    const user = userEvent.setup()
    render(<IncomeStatementConfigPage />)
    await user.click(await screen.findByRole('button', { name: 'Enregistrer la configuration' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Le compte 512 ne peut pas alimenter le compte de résultat'))
    expect(sent('PATCH')).toHaveLength(2)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('deletes a line and reloads the layout', async () => {
    replies['DELETE /api/companies/c1/income-statement/config/line/l-stocks'] = { body: { ok: true } }
    const user = userEvent.setup()
    render(<IncomeStatementConfigPage />)
    await user.click(await screen.findByRole('button', { name: 'Supprimer la ligne' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ligne supprimée'))
    expect(configQueries()).toEqual(['complete', 'complete'])
  })

  it('resets the variant to the PCG model only after confirmation', async () => {
    replies['POST /api/companies/c1/income-statement/config/default'] = { body: CONFIG }
    const user = userEvent.setup()
    render(<IncomeStatementConfigPage />)
    await user.click(await screen.findByRole('button', { name: /Réinitialiser/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/variante complète reviennent au modèle du PCG/)).toBeInTheDocument()
    expect(sent('POST')).toHaveLength(0)
    await user.click(within(confirm).getByRole('button', { name: 'Réinitialiser' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Configuration réinitialisée'))
    expect(JSON.parse(String(sent('POST')[0][1]?.body))).toEqual({ variant: 'complete' })
  })
})
