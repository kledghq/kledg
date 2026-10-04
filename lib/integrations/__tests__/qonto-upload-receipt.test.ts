/**
 * uploadQontoReceipt (lib/integrations/providers/qonto/sync-attachments.ts):
 * the receipt goes to the Qonto uuid of the company's own Qonto
 * transaction, then the transaction's receipts are copied back once; a
 * failing copy never undoes the upload (the next sync brings it). Prisma
 * and the Qonto client are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const qonto = vi.hoisted(() => ({ uploadTransactionAttachment: vi.fn(async () => {}), listTransactionAttachments: vi.fn() }))
vi.mock('@/lib/integrations/providers/qonto/get-credentials', () => ({ qontoClientFor: vi.fn(async () => qonto) }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { logger } from '@/lib/logger'
import { uploadQontoReceipt } from '@/lib/integrations/providers/qonto/sync-attachments'

const db = asPrismaMock(prisma)
const UUID = '0b7f1d64-5a8c-4b6e-9a51-3f1c2d3e4f50'
const file = new File(['%PDF'], 'facture.pdf', { type: 'application/pdf' })

describe('uploadQontoReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.integration.findFirst.mockResolvedValue({ id: 'int-1' } as never)
    db.bankTransaction.findFirst.mockResolvedValue({ id: 'tx-1', externalTransactionId: 'ext-1', providerData: { id: UUID }, attachments: [] } as never)
    db.attachment.findMany.mockResolvedValue([])
    db.attachment.count.mockResolvedValue(1)
  })

  it('uploads to the Qonto uuid of the company’s Qonto transaction and copies the receipt back', async () => {
    qonto.listTransactionAttachments.mockResolvedValue({ attachments: [{ id: 'att-1', file_name: 'facture.pdf', file_size: '4', file_content_type: 'application/pdf', url: 'https://qonto.example/f', created_at: '2026-10-01' }] })
    await expect(uploadQontoReceipt('company-1', 'tx-1', file, 'key-1')).resolves.toEqual({ receipts: 1 })
    expect(db.bankTransaction.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'tx-1', bankAccount: { bankConnection: { companyId: 'company-1', provider: 'QONTO' } } })
    expect(qonto.uploadTransactionAttachment).toHaveBeenCalledWith(UUID, file, 'key-1')
    expect(db.attachment.create.mock.calls[0][0].data).toMatchObject({ companyId: 'company-1', integrationId: 'int-1', bankTransactionId: 'tx-1', externalAttachmentId: 'att-1', fileName: 'facture.pdf' })
  })

  it('keeps the upload when the copy fails', async () => {
    qonto.listTransactionAttachments.mockRejectedValue(new Error('timeout'))
    await expect(uploadQontoReceipt('company-1', 'tx-1', file, 'key-2')).resolves.toEqual({ receipts: 1 })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('refuses a company without Qonto and a transaction of another bank or company', async () => {
    db.integration.findFirst.mockResolvedValueOnce(null)
    await expect(uploadQontoReceipt('company-1', 'tx-1', file, 'k')).rejects.toMatchObject({ statusCode: 404 })
    db.bankTransaction.findFirst.mockResolvedValueOnce(null)
    await expect(uploadQontoReceipt('company-1', 'tx-1', file, 'k')).rejects.toThrow('Transaction Qonto introuvable')
    expect(qonto.uploadTransactionAttachment).not.toHaveBeenCalled()
  })
})
