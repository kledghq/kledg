/**
 * Qonto receipt reads (KLEDG-R3-MCP-06): each read counts in the company's
 * limit of bank calls, and a receipt larger than the reader's budget is
 * refused from Qonto's metadata, before any download.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ listTransactionAttachments: vi.fn() }))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/banking/guard', () => ({ limitBankCalls: vi.fn() }))
vi.mock('@/lib/integrations/providers/qonto/get-credentials', () => ({ qontoClientFor: vi.fn(async () => client) }))
vi.mock('@/lib/integrations/public-https-fetch', () => ({ publicFetch: vi.fn(async () => new Response('%PDF-1.7', { status: 200 })) }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { limitBankCalls } from '@/lib/banking/guard'
import { publicFetch } from '@/lib/integrations/public-https-fetch'
import { listQontoTransactionAttachments, readQontoReceipt } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'
import { MCP_FILE_BUDGET } from '@/lib/mcp/file-result'

const db = asPrismaMock(prisma)
const UUID = '0b2a8f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

beforeEach(() => {
  vi.clearAllMocks()
  db.attachment.findFirst.mockResolvedValue({
    externalAttachmentId: 'att-1',
    transactionUuid: UUID,
    fileName: 'recu.pdf',
    fileContentType: 'application/pdf',
    fileUrl: null,
    bankTransaction: null,
  } as never)
})

describe('readQontoReceipt', () => {
  it('counts one bank call per read and returns the file', async () => {
    client.listTransactionAttachments.mockResolvedValue({ attachments: [{ id: 'att-1', url: 'https://files.qonto.com/recu.pdf', file_size: '8', file_name: 'recu.pdf', file_content_type: 'application/pdf' }] })
    const receipt = await readQontoReceipt('c1', 'att-1', undefined, MCP_FILE_BUDGET)
    expect(new TextDecoder().decode(receipt.body)).toBe('%PDF-1.7')
    expect(limitBankCalls).toHaveBeenCalledTimes(1)
    expect(limitBankCalls).toHaveBeenCalledWith('c1')
  })

  it('refuses a receipt above the budget from the size Qonto declares, without downloading it', async () => {
    client.listTransactionAttachments.mockResolvedValue({ attachments: [{ id: 'att-1', url: 'https://files.qonto.com/recu.pdf', file_size: String(20 * 1024 * 1024) }] })
    await expect(readQontoReceipt('c1', 'att-1', undefined, MCP_FILE_BUDGET)).rejects.toThrow(/^Fichier trop volumineux pour être transmis à l'assistant/)
    expect(publicFetch).not.toHaveBeenCalled()
  })
})

describe('listQontoTransactionAttachments', () => {
  it('counts one bank call per listing', async () => {
    client.listTransactionAttachments.mockResolvedValue({ attachments: [] })
    await listQontoTransactionAttachments('c1', UUID, {})
    expect(limitBankCalls).toHaveBeenCalledWith('c1')
  })
})
