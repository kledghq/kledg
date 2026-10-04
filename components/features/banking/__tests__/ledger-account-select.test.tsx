import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { CompanyAccessProvider } from '@/components/features/companies/company-access'
import { LedgerAccountSelect } from '../ledger-account-select'

const norm = (text: string | null | undefined) => (text ?? '').replace(/[\u202f\u00a0]/g, ' ')

// Class 512 "Banques" holds one sub-account per bank account (PCG art. 932-1, chart of accounts)
const OPTIONS = [
  { id: 'acc-1', code: '512100', label: 'Banque BNP' },
  { id: 'acc-2', code: '512200', label: 'Banque Qonto' },
]

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const LABEL = 'Compte comptable de Compte courant'

describe('LedgerAccountSelect', () => {
  it('saves the chosen 512 account at once and reports it', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, {}))
    const onSaved = vi.fn()
    render(<LedgerAccountSelect bankAccountId="ba-1" value={null} options={OPTIONS} label={LABEL} onSaved={onSaved} />)

    const trigger = screen.getByRole('combobox', { name: LABEL })
    expect(trigger).toHaveTextContent('Non associé')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: '512200 Banque Qonto' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('512200'))
    expect(fetchMock).toHaveBeenCalledWith('/api/banking/accounts/ba-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ledgerAccountCode: '512200' }),
    })
    expect(toast.success).toHaveBeenCalledWith('Compte 512200 associé')
    expect(trigger).toHaveTextContent('512200 Banque Qonto')
  })

  it('removes the mapping with a null code', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(200, {}))
    const onSaved = vi.fn()
    render(<LedgerAccountSelect bankAccountId="ba-1" value="512100" options={OPTIONS} label={LABEL} onSaved={onSaved} />)

    await user.click(screen.getByRole('combobox', { name: LABEL }))
    await user.click(await screen.findByRole('option', { name: 'Non associé' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(null))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ ledgerAccountCode: null })
    expect(toast.success).toHaveBeenCalledWith('Association retirée')
  })

  it('goes back to the previous account and shows the API error when the save fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(json(400, { error: "Le compte 512200 n'existe pas dans l'exercice en cours." }))
    const onSaved = vi.fn()
    render(<LedgerAccountSelect bankAccountId="ba-1" value="512100" options={OPTIONS} label={LABEL} onSaved={onSaved} />)

    const trigger = screen.getByRole('combobox', { name: LABEL })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: '512200 Banque Qonto' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Le compte 512200 n'existe pas dans l'exercice en cours."))
    expect(trigger).toHaveTextContent('512100 Banque BNP')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('uses a French fallback when the error body is unreadable', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    render(<LedgerAccountSelect bankAccountId="ba-1" value={null} options={OPTIONS} label={LABEL} />)

    await user.click(screen.getByRole('combobox', { name: LABEL }))
    await user.click(await screen.findByRole('option', { name: '512100 Banque BNP' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Le compte comptable n'a pas pu être enregistré."))
  })

  it('keeps a saved code that is no longer among the options', async () => {
    const user = userEvent.setup()
    render(<LedgerAccountSelect bankAccountId="ba-1" value="512900" options={OPTIONS} label={LABEL} />)
    const trigger = screen.getByRole('combobox', { name: LABEL })
    expect(trigger).toHaveTextContent('512900')
    await user.click(trigger)
    expect(await screen.findAllByRole('option')).toHaveLength(4)
  })

  it('is disabled when asked, and with the reason for a role that cannot manage banking', () => {
    const { unmount } = render(<LedgerAccountSelect bankAccountId="ba-1" value={null} options={OPTIONS} label={LABEL} disabled />)
    expect(screen.getByRole('combobox', { name: LABEL })).toBeDisabled()
    unmount()

    render(
      <CompanyAccessProvider value={{ granted: { banking: ['read'] }, roleLabel: 'Lecteur' }}>
        <LedgerAccountSelect bankAccountId="ba-1" value={null} options={OPTIONS} label={LABEL} />
      </CompanyAccessProvider>,
    )
    const trigger = screen.getByRole('combobox', { name: LABEL })
    expect(trigger).toBeDisabled()
    expect(norm(trigger.getAttribute('title'))).toBe(
      'Votre rôle (Lecteur) ne permet pas de changer le compte comptable : demandez-le à un administrateur de la société.',
    )
  })
})
