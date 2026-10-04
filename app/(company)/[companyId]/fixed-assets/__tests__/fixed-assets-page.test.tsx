/**
 * Immobilisations page: the figures of each asset (net book value =
 * acquisition value minus the depreciation posted, PCG art. 214-13 and
 * 821-1; a non depreciable asset such as land keeps its value, PCG art.
 * 214-1), the depreciated fiscal years, creation and deletion. fetch is
 * mocked; the form dialog is replaced by a stub that submits fixed values
 * (it has its own tests).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ companyId: 'c1' }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/c1/fixed-assets',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/features/fixed-assets/fixed-asset-form-dialog', () => ({
  FixedAssetFormDialog: ({ open, onSubmit, error }: { open: boolean; onSubmit: (data: Record<string, unknown>) => void; error: string | null }) =>
    open ? (
      <div role="dialog" aria-label="Nouvelle immobilisation">
        {error ? <p>{error}</p> : null}
        <button
          type="button"
          onClick={() =>
            onSubmit({
              label: 'Serveur',
              acquisitionDate: '2026-02-01',
              acquisitionValue: 3600,
              depreciationMethod: 'linear',
              depreciationDuration: 3,
              depreciationStartDate: '2026-02-01',
              assetAccountId: 'acc-2183',
              depreciationAccountId: 'acc-28183',
              expenseAccountId: 'acc-6811',
            })
          }
        >
          Enregistrer
        </button>
      </div>
    ) : null,
}))
vi.mock('@/components/features/fixed-assets/depreciation-detail-dialog', () => ({ DepreciationDetailDialog: () => null }))

import { toast } from 'sonner'
import FixedAssetsPage from '../page'

const asset = (overrides: Record<string, unknown>) => ({
  acquisitionDate: '2025-07-01',
  depreciationRate: null,
  depreciationDuration: 3,
  depreciationMethod: 'linear',
  depreciationStartDate: '2025-07-01',
  assetAccountId: 'acc-2183',
  depreciationAccountId: 'acc-28183',
  expenseAccountId: 'acc-6811',
  isActive: true,
  ...overrides,
})

const ASSETS = [
  asset({ id: 'fa1', label: 'Ordinateur portable', acquisitionValue: 1200.1 }),
  asset({ id: 'fa2', label: 'Véhicule utilitaire', acquisitionValue: 24000, depreciationMethod: 'declining', depreciationRate: 37.5, depreciationDuration: null }),
  asset({ id: 'fa3', label: 'Terrain', acquisitionValue: 50000, depreciationMethod: 'none', depreciationDuration: null }),
]

const STATUS: Record<string, unknown> = {
  // 200,05 (2025, prorata) + 400,03 (2026) posted: VNC 1 200,10 - 600,08 = 600,02, computed in cents
  fa1: {
    done: false,
    baseAmount: 1200.1,
    totalPosted: 600.08,
    remainingCapacity: 600.02,
    fiscalYears: [
      { fiscalYearId: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, entriesCount: 1, amount: 400.03, postedAmount: 400.03, done: true, lastEntryDate: '2026-12-31' },
      { fiscalYearId: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true, entriesCount: 1, amount: 200.05, postedAmount: 200.05, done: true, lastEntryDate: '2025-12-31' },
    ],
  },
  fa2: { done: false, baseAmount: 24000, totalPosted: 0, remainingCapacity: 24000, fiscalYears: [] },
  fa3: { done: true, baseAmount: 0, totalPosted: 0, remainingCapacity: 0, fiscalYears: [] },
}

let replies: Record<string, { status?: number; body: unknown }>
let fetchMock: ReturnType<typeof vi.fn>
const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  replies = {}
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const key = `${init?.method ?? 'GET'} ${url}`
    if (replies[key]) return respond(replies[key].status ?? 200, replies[key].body)
    if (key === 'GET /api/fixed-assets?companyId=c1') return respond(200, ASSETS)
    if (key === 'GET /api/accounts?companyId=c1') return respond(200, [])
    if (key === 'GET /api/fixed-assets/stats?companyId=c1') return respond(200, { totalAssets: 75200.1, previousDepreciation: 200.05, currentDepreciation: 400.03 })
    const status = /^GET \/api\/fixed-assets\/(\w+)\/depreciation-status/.exec(key)
    if (status) return respond(200, STATUS[status[1]])
    return respond(404, { error: `unexpected ${key}` })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const cellsOf = async (label: string) =>
  within((await screen.findByText(label)).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

describe('fixed assets page', () => {
  it('shows the value, the depreciation posted and the net book value of a depreciated asset', async () => {
    render(<FixedAssetsPage />)
    await waitFor(async () => expect((await cellsOf('Ordinateur portable'))[3]).toBe('600,08 €'))
    const cells = await cellsOf('Ordinateur portable')
    expect(cells.slice(0, 7)).toEqual([
      'Ordinateur portable',
      '01/07/2025',
      '1 200,10 €',
      '600,08 €',
      '600,02 €',
      'Linéaire, 3 ans',
      '2025, 2026',
    ])
    expect(screen.getByText('2025, 2026')).toHaveAttribute('title', "2 exercices, 2 écritures d'amortissement, 600,08 €")
  })

  it('shows a declining method with its French rate, and a land kept at its value', async () => {
    render(<FixedAssetsPage />)
    expect((await cellsOf('Véhicule utilitaire'))[5]).toBe('Dégressif, 37,5 %')
    const land = await cellsOf('Terrain')
    expect(land.slice(2, 7)).toEqual(['50 000,00 €', 'Non amortie', '50 000,00 €', 'Non amortissable', 'Sans objet'])
    // Nothing to depreciate: no depreciation button on the land
    const landRow = (await screen.findByText('Terrain')).closest('tr') as HTMLElement
    expect(within(landRow).queryByRole('button', { name: /Amortissements/ })).not.toBeInTheDocument()
  })

  it('creates an asset with the company id and adds it to the list', async () => {
    replies['POST /api/fixed-assets'] = { status: 201, body: asset({ id: 'fa4', label: 'Serveur', acquisitionValue: 3600, acquisitionDate: '2026-02-01' }) }
    const user = userEvent.setup()
    render(<FixedAssetsPage />)
    await screen.findByText('Ordinateur portable')
    await user.click(screen.getAllByRole('button', { name: /Ajouter une immobilisation/ })[0])
    await user.click(within(await screen.findByRole('dialog', { name: 'Nouvelle immobilisation' })).getByRole('button', { name: 'Enregistrer' }))

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ companyId: 'c1', label: 'Serveur', acquisitionValue: 3600, depreciationDuration: 3 })
    expect(await screen.findByText('Serveur')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Immobilisation créée')
  })

  it('keeps the dialog open with the error of the API', async () => {
    replies['POST /api/fixed-assets'] = { status: 400, body: { error: "La date de début d'amortissement précède l'acquisition" } }
    const user = userEvent.setup()
    render(<FixedAssetsPage />)
    await screen.findByText('Ordinateur portable')
    await user.click(screen.getAllByRole('button', { name: /Ajouter une immobilisation/ })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Nouvelle immobilisation' })
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(await within(dialog).findByText("La date de début d'amortissement précède l'acquisition")).toBeInTheDocument()
  })

  it('deletes an asset after confirmation and says how many depreciation entries went with it', async () => {
    replies['DELETE /api/fixed-assets/fa1'] = { body: { deletedEntries: 2 } }
    const user = userEvent.setup()
    render(<FixedAssetsPage />)
    await user.click(await screen.findByRole('button', { name: 'Autres actions sur Ordinateur portable' }))
    await user.click(await screen.findByRole('menuitem', { name: /Supprimer/ }))
    const confirm = await screen.findByRole('alertdialog')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await user.click(within(confirm).getByRole('button', { name: /Supprimer/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Immobilisation supprimée avec 2 écritures d'amortissement"))
    await waitFor(() => expect(screen.queryByText('Ordinateur portable')).not.toBeInTheDocument())
  })
})
