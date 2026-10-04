/**
 * "Ajouter le justificatif" (lib/simple/upload-receipt.service.ts): a Qonto
 * transaction's receipt goes to Qonto within the bank API limit; the type
 * and size are checked first; other banks are told what to do instead.
 * Qonto and the rate limit are mocked (no network).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/banking/guard', () => ({ limitBankCalls: vi.fn(async () => {}) }))
vi.mock('@/lib/integrations/providers/qonto/sync-attachments', () => ({ uploadQontoReceipt: vi.fn(async () => ({ receipts: 1 })) }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { limitBankCalls } from '@/lib/banking/guard'
import { uploadQontoReceipt } from '@/lib/integrations/providers/qonto/sync-attachments'
import { writeAuditLog } from '@/lib/audit'
import { RECEIPT_MESSAGES, uploadExpenseReceipt } from '../upload-receipt.service'

const db = asPrismaMock(prisma)
const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'facture.pdf', { type: 'application/pdf' })
const transactionOf = (provider: string) => ({ id: 'tx-1', bankAccount: { bankConnection: { provider } } })

describe('uploadExpenseReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the receipt of a Qonto transaction to Qonto within the bank API limit, and audits it', async () => {
    db.bankTransaction.findFirst.mockResolvedValue(transactionOf('QONTO') as never)
    await expect(uploadExpenseReceipt('company-1', 'tx-1', pdf())).resolves.toEqual({ transactionId: 'tx-1', receipts: 1 })
    expect(db.bankTransaction.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'tx-1', bankAccount: { bankConnection: { companyId: 'company-1' } } })
    expect(limitBankCalls).toHaveBeenCalledWith('company-1')
    expect(vi.mocked(uploadQontoReceipt).mock.calls[0].slice(0, 2)).toEqual(['company-1', 'tx-1'])
    expect(vi.mocked(writeAuditLog).mock.calls[0][2]).toMatchObject({ action: 'SIMPLE_MODE_RECEIPT_UPLOADED', companyId: 'company-1' })
  })

  it('refuses another company’s transaction as missing', async () => {
    db.bankTransaction.findFirst.mockResolvedValue(null)
    await expect(uploadExpenseReceipt('company-1', 'tx-9', pdf())).rejects.toMatchObject({ statusCode: 404 })
    expect(uploadQontoReceipt).not.toHaveBeenCalled()
  })

  it('checks the file before calling the bank', async () => {
    db.bankTransaction.findFirst.mockResolvedValue(transactionOf('QONTO') as never)
    await expect(uploadExpenseReceipt('company-1', 'tx-1', null)).rejects.toThrow(RECEIPT_MESSAGES.missing)
    await expect(uploadExpenseReceipt('company-1', 'tx-1', new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(RECEIPT_MESSAGES.type)
    expect(limitBankCalls).not.toHaveBeenCalled()
  })

  it('tells the user of another bank to keep the receipt for the accountant', async () => {
    db.bankTransaction.findFirst.mockResolvedValue(transactionOf('PONTO') as never)
    await expect(uploadExpenseReceipt('company-1', 'tx-1', pdf())).rejects.toThrow(RECEIPT_MESSAGES.notQonto)
    expect(uploadQontoReceipt).not.toHaveBeenCalled()
  })
})
