import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReverseEntryDialog } from '../reverse-entry-dialog'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const ENTRY = { id: 'e-1', entryNumber: 'VT-12', date: '2025-03-31T00:00:00.000Z', description: 'Facture 12' }

const json = (data: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 400, json: async () => data }) as unknown as Response

function renderDialog(fetchImpl: () => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl)
  vi.stubGlobal('fetch', fetchMock)
  const onOpenChange = vi.fn()
  const onReversed = vi.fn()
  render(<ReverseEntryDialog open onOpenChange={onOpenChange} entry={ENTRY} onReversed={onReversed} />)
  return { fetchMock, onOpenChange, onReversed, user: userEvent.setup() }
}

describe('ReverseEntryDialog', () => {
  const originalTz = process.env.TZ
  beforeEach(() => {
    vi.mocked(toast.success).mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.TZ = originalTz
  })

  it('defaults to the calendar day of the original entry, whatever the browser timezone', () => {
    // Stored at midnight UTC: a browser west of UTC must still read 31 March.
    process.env.TZ = 'America/Los_Angeles'
    renderDialog(async () => json({}))
    expect(screen.getByRole('heading', { name: "Contre-passer l'écriture n° VT-12" })).toBeInTheDocument()
    expect(screen.getByLabelText('Date de la contre-passation')).toHaveValue('31/03/2025')
  })

  it('posts the reversal on the chosen date and reports the new entry', async () => {
    const reversal = { id: 'e-2', entryNumber: 'VT-13', date: '2025-04-01' }
    const { fetchMock, onOpenChange, onReversed, user } = renderDialog(async () => json(reversal))
    const field = screen.getByLabelText('Date de la contre-passation')
    await user.clear(field)
    await user.type(field, '01/04/2025')

    await user.click(screen.getByRole('button', { name: 'Contre-passer' }))

    // PCG art. 1031-3: a validated entry is corrected by a contre-passation,
    // a new entry that swaps debits and credits (built by the API route).
    await waitFor(() => expect(onReversed).toHaveBeenCalledWith(reversal))
    expect(fetchMock).toHaveBeenCalledWith('/api/entries/e-1/reverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2025-04-01' }),
    })
    expect(toast.success).toHaveBeenCalledWith("Écriture n° VT-12 contre-passée par l'écriture n° VT-13")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables the action while the date is not valid', async () => {
    const { user } = renderDialog(async () => json({}))
    const field = screen.getByLabelText('Date de la contre-passation')
    await user.clear(field)
    expect(screen.getByRole('button', { name: 'Contre-passer' })).toBeDisabled()
    await user.type(field, '31/02/2025')
    expect(screen.getByText(/Date invalide/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Contre-passer' })).toBeDisabled()
  })

  it('shows the API error inside the dialog', async () => {
    const { onOpenChange, onReversed, user } = renderDialog(async () =>
      json({ error: "L'exercice 2025 est clôturé : choisissez une date d'un exercice ouvert." }, false)
    )
    await user.click(screen.getByRole('button', { name: 'Contre-passer' }))
    expect(
      await screen.findByText("L'exercice 2025 est clôturé : choisissez une date d'un exercice ouvert.")
    ).toBeInTheDocument()
    expect(onReversed).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('asks to retry when the network fails', async () => {
    const { user } = renderDialog(async () => {
      throw new TypeError('Failed to fetch')
    })
    await user.click(screen.getByRole('button', { name: 'Contre-passer' }))
    expect(await screen.findByText('La contre-passation a échoué. Réessayez.')).toBeInTheDocument()
  })
})
