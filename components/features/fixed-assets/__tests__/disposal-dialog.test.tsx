import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DisposalDialog } from '../disposal-dialog'
import type { DisposalPreview } from '@/lib/fixed-assets/disposal'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const norm = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ')

const PREVIEW: DisposalPreview = {
  fixedAsset: { id: 'fa-1', label: 'Utilitaire', assetAccount: '218200', depreciationAccount: '281820' },
  fiscalYear: { id: 'fy-2026', year: 2026 },
  disposalDate: '2026-06-30',
  kind: 'sale',
  kindLabel: 'Cession (vente)',
  grossCents: 1_200_000,
  depreciationCents: 360_000,
  priceCents: 900_000,
  priceRecorded: false,
  result: { netBookValueCents: 840_000, gainCents: 60_000, heldTwoYears: false, shortTermCents: 60_000, longTermCents: 0, explanation: "À l'impôt sur les sociétés, la plus-value est à court terme." },
  taxation: 'Société à l’impôt sur les sociétés.',
  lines: [
    { code: '281820', label: 'Amortissements', debitCents: 360_000, creditCents: 0 },
    { code: '657', label: 'Valeurs comptables', debitCents: 840_000, creditCents: 0 },
    { code: '218200', label: 'Matériel de transport', debitCents: 0, creditCents: 1_200_000 },
    { code: '462', label: 'Créances sur cessions', debitCents: 900_000, creditCents: 0 },
    { code: '757', label: 'Produits des cessions', debitCents: 0, creditCents: 900_000 },
  ],
  warnings: ['La dotation de l’exercice 2026 n’est pas encore comptabilisée.'],
  entry: null,
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('DisposalDialog', () => {
  it('computes the gain with a dry run, then prepares the draft exit entry', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body))
      return Response.json(body.dryRun ? PREVIEW : { ...PREVIEW, entry: { id: 'e-1', entryNumber: 'BR-12' } })
    })
    const onChanged = vi.fn()
    render(<DisposalDialog open onOpenChange={() => {}} asset={{ id: 'fa-1', label: 'Utilitaire' }} onChanged={onChanged} />)

    expect(screen.getByRole('button', { name: "Préparer l'écriture de sortie" })).toBeDisabled()
    await user.type(screen.getByLabelText('Date de sortie'), '30/06/2026')
    await user.type(screen.getByLabelText('Prix de cession HT'), '9000')
    await user.click(screen.getByRole('button', { name: 'Calculer' }))

    const preview = await screen.findByRole('table', { name: 'Écriture de sortie' })
    expect(within(preview).getAllByRole('row')).toHaveLength(6)
    expect(norm(document.querySelector('[data-slot="disposal-preview"]')?.textContent)).toContain('Plus-value')
    expect(screen.getByText(/pas encore comptabilisée/)).toBeInTheDocument()
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(sent).toEqual({ disposalDate: '2026-06-30', kind: 'sale', price: 9000, priceRecorded: false, dryRun: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/fixed-assets/fa-1/disposal')

    await user.click(screen.getByRole('button', { name: "Préparer l'écriture de sortie" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).dryRun).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Écriture de sortie n° BR-12 préparée en brouillon', expect.anything())
  })

  it('shows the refusal, and cancels a recorded exit', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((_url, init) =>
      init?.method === 'DELETE' ? Response.json({ deletedEntry: true }) : Response.json({ error: 'L’exercice 2026 est clôturé.' }, { status: 409 }),
    )
    const onChanged = vi.fn()
    render(
      <DisposalDialog
        open
        onOpenChange={() => {}}
        asset={{ id: 'fa-1', label: 'Utilitaire', disposalDate: '2026-06-30T00:00:00.000Z', disposalKind: 'scrap', disposalPrice: null, disposalEntryId: 'e-1' }}
        onChanged={onChanged}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Calculer' }))
    expect(await screen.findByText('L’exercice 2026 est clôturé.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Annuler la sortie' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })
})
