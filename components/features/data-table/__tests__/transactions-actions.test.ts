import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import {
  handleCopyTransactionId,
  handleReconcileTransaction,
  handleUnreconcileTransaction,
} from '../transactions-actions'
import type { BankTransaction } from '../transactions-types'

function tx(reconciled: boolean): BankTransaction {
  return {
    id: 'tx-42',
    amount: 120,
    date: '2026-03-01T00:00:00.000Z',
    label: 'Prélèvement EDF',
    reference: null,
    side: 'debit',
    reconciled,
    bankAccount: { id: 'ba', name: 'Compte courant', displayName: null, iban: null },
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  vi.clearAllMocks()
})

describe('handleCopyTransactionId', () => {
  it('copies the id and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await handleCopyTransactionId('tx-42')
    expect(writeText).toHaveBeenCalledWith('tx-42')
    expect(toast.success).toHaveBeenCalledWith('Identifiant copié')
  })

  it('says when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    await handleCopyTransactionId('tx-42')
    expect(toast.error).toHaveBeenCalledWith("Impossible de copier l'identifiant")
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('handleReconcileTransaction', () => {
  it('posts to the reconcile route and calls back on success', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    const onSuccess = vi.fn()
    await handleReconcileTransaction(tx(false), 'c1', onSuccess)
    expect(fetchMock).toHaveBeenCalledWith('/api/transactions/tx-42/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(toast.success).toHaveBeenCalledWith('Transaction rapprochée avec succès')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a transaction already reconciled', async () => {
    await handleReconcileTransaction(tx(true), 'c1')
    expect(toast.info).toHaveBeenCalledWith('Cette transaction est déjà rapprochée')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the API error, or a default message', async () => {
    const onSuccess = vi.fn()
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Aucune écriture ne correspond à ce montant." }, { status: 422 }))
    await handleReconcileTransaction(tx(false), 'c1', onSuccess)
    expect(toast.error).toHaveBeenLastCalledWith('Aucune écriture ne correspond à ce montant.')

    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 500 }))
    await handleReconcileTransaction(tx(false), 'c1', onSuccess)
    expect(toast.error).toHaveBeenLastCalledWith('Erreur lors du rapprochement')

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await handleReconcileTransaction(tx(false), 'c1', onSuccess)
    expect(toast.error).toHaveBeenLastCalledWith('Erreur lors du rapprochement')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('works without a callback', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await expect(handleReconcileTransaction(tx(false), 'c1')).resolves.toBeUndefined()
    expect(toast.success).toHaveBeenCalled()
  })
})

describe('handleUnreconcileTransaction', () => {
  it('deletes the reconciliation of the transaction and calls back', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    const onSuccess = vi.fn()
    await handleUnreconcileTransaction(tx(true), 'c1', onSuccess)
    expect(fetchMock).toHaveBeenCalledWith('/api/banking/reconciliation?transactionId=tx-42', { method: 'DELETE' })
    expect(toast.success).toHaveBeenCalledWith('Rapprochement annulé avec succès')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a transaction that is not reconciled', async () => {
    await handleUnreconcileTransaction(tx(false), 'c1')
    expect(toast.info).toHaveBeenCalledWith("Cette transaction n'est pas rapprochée")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the API error, or a default message', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "L'exercice est clôturé." }, { status: 409 }))
    await handleUnreconcileTransaction(tx(true), 'c1')
    expect(toast.error).toHaveBeenLastCalledWith("L'exercice est clôturé.")

    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 500 }))
    await handleUnreconcileTransaction(tx(true), 'c1')
    expect(toast.error).toHaveBeenLastCalledWith("Erreur lors de l'annulation du rapprochement")

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await handleUnreconcileTransaction(tx(true), 'c1')
    expect(toast.error).toHaveBeenLastCalledWith("Erreur lors de l'annulation du rapprochement")
  })
})
