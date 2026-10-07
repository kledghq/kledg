/**
 * Qonto credentials of a company (lib/integrations/providers/qonto/get-credentials.ts)
 * and its receipts (read-qonto-attachments.service.ts), with Prisma mocked
 * and Qonto answered by a stubbed fetch (no network):
 * - the legacy connection key first, then the active integration; an
 *   unreadable key gives a French message and the decryption detail stays
 *   in the log;
 * - receipts: every lookup scoped by company, the Qonto uuid resolved from
 *   the company's own transaction, a fresh Qonto URL preferred over the
 *   stored one, and the stored one used when Qonto has none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/integrations/public-https-fetch', () => ({
  publicFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { logger } from '@/lib/logger'
import { bankConnectionContext, encrypt, integrationContext } from '@/lib/integrations/encryption'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { getQontoCredentials, QONTO_NOT_CONNECTED_MESSAGE, qontoClientFor } from '@/lib/integrations/providers/qonto/get-credentials'
import {
  companyOfQontoAttachment,
  listQontoTransactionAttachments,
  readQontoReceipt,
} from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'

const db = asPrismaMock(prisma)
const KEY = 'c'.repeat(64)
const OTHER_KEY = 'd'.repeat(64)
const COMPANY = 'company-1'
const UNREADABLE = 'La clé API Qonto enregistrée ne peut plus être lue : saisissez-la de nouveau depuis la page Banque.'
const TX_UUID = '0b7f1d64-5a8c-4b6e-9a51-3f1c2d3e4f50'

const calls: URL[] = []
const authorizations: Array<string | null> = []
function stubQonto(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push(url)
      authorizations.push(new Headers(init?.headers).get('authorization'))
      const match = Object.entries(routes).find(([path]) => url.pathname.endsWith(path))
      return match ? match[1]() : new Response('{}', { status: 500 })
    }),
  )
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ENCRYPTION_KEY = KEY
  calls.length = 0
  authorizations.length = 0
  db.bankConnection.findUnique.mockResolvedValue(null)
  db.integration.findFirst.mockResolvedValue({ credentials: { login: 'acme', secretKey: 'plain-secret' }, credentialsEncrypted: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ENCRYPTION_KEY
})

describe('getQontoCredentials', () => {
  it('reads the legacy key of the company connection first', async () => {
    db.bankConnection.findUnique.mockResolvedValue({ login: 'legacy-org', secretKeyEncrypted: encrypt('legacy-secret', KEY, bankConnectionContext(COMPANY, 'QONTO')) })
    expect(await getQontoCredentials(COMPANY)).toEqual({ login: 'legacy-org', secretKey: 'legacy-secret' })
    expect(db.bankConnection.findUnique.mock.calls[0][0]).toEqual({
      where: { companyId_provider: { companyId: COMPANY, provider: 'QONTO' } },
      select: { login: true, secretKeyEncrypted: true },
    })
    expect(db.integration.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to the integration when the legacy key cannot be decrypted', async () => {
    db.bankConnection.findUnique.mockResolvedValue({ login: 'legacy-org', secretKeyEncrypted: encrypt('legacy-secret', OTHER_KEY, bankConnectionContext(COMPANY, 'QONTO')) })
    db.integration.findFirst.mockResolvedValue({ credentials: { login: 'acme', secretKey: encrypt('sealed-secret', KEY, integrationContext(COMPANY, 'QONTO', 'secretKey')) }, credentialsEncrypted: true })
    expect(await getQontoCredentials(COMPANY)).toEqual({ login: 'acme', secretKey: 'sealed-secret' })
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(db.integration.findFirst.mock.calls[0][0]?.where).toEqual({ companyId: COMPANY, provider: 'QONTO', status: 'active', type: 'BANKING' })
  })

  it('reads a key stored in clear on an older integration', async () => {
    expect(await getQontoCredentials(COMPANY)).toEqual({ login: 'acme', secretKey: 'plain-secret' })
  })

  it('answers 404 in French when Qonto is not connected', async () => {
    db.integration.findFirst.mockResolvedValue(null)
    await expect(getQontoCredentials(COMPANY)).rejects.toThrow(new NotFoundError(QONTO_NOT_CONNECTED_MESSAGE))
  })

  it('answers a French message, never the decryption detail, for a key sealed with another instance key', async () => {
    db.integration.findFirst.mockResolvedValue({ credentials: { login: 'acme', secretKey: encrypt('sealed', OTHER_KEY, integrationContext(COMPANY, 'QONTO', 'secretKey')) }, credentialsEncrypted: true })
    const error = await getQontoCredentials(COMPANY).catch((e: unknown) => e)
    expect(error).toEqual(new ValidationError(UNREADABLE))
    expect(logger.error).toHaveBeenCalledWith('[Qonto] Integration key unreadable', expect.anything())
  })

  it('refuses incomplete stored credentials', async () => {
    for (const credentials of [{ login: 'acme' }, { secretKey: 's' }, { login: 42, secretKey: 's' }, null]) {
      db.integration.findFirst.mockResolvedValue({ credentials, credentialsEncrypted: false })
      await expect(getQontoCredentials(COMPANY), JSON.stringify(credentials)).rejects.toThrow(new ValidationError(UNREADABLE))
    }
  })

  it('builds a client that calls Qonto with the stored key', async () => {
    process.env.QONTO_API_URL = 'https://qonto.test/v2'
    try {
      stubQonto({ '/organization': ok({ organization: { bank_accounts: [] } }) })
      await (await qontoClientFor(COMPANY)).getAccounts()
      expect(calls.map(String)).toEqual(['https://qonto.test/v2/organization'])
      expect(authorizations).toEqual(['acme:plain-secret'])
    } finally {
      delete process.env.QONTO_API_URL
    }
  })
})

describe('listQontoTransactionAttachments', () => {
  it('uses a Qonto uuid directly and passes the page', async () => {
    stubQonto({ '/attachments': ok({ attachments: [{ id: 'qa-1' }], meta: { current_page: 2 } }) })
    expect(await listQontoTransactionAttachments(COMPANY, TX_UUID, { page: 2, per_page: 10 })).toEqual({
      attachments: [{ id: 'qa-1' }],
      meta: { current_page: 2 },
    })
    expect(calls[0].pathname).toBe(`/v2/transactions/${TX_UUID}/attachments`)
    expect(calls[0].searchParams.get('page')).toBe('2')
    expect(calls[0].searchParams.get('per_page')).toBe('10')
    expect(db.bankTransaction.findFirst).not.toHaveBeenCalled()
  })

  it('resolves an external id through the company transaction and its Qonto uuid', async () => {
    db.bankTransaction.findFirst.mockResolvedValue({ providerData: { id: TX_UUID } })
    stubQonto({ '/attachments': ok({ attachments: [] }) })
    await listQontoTransactionAttachments(COMPANY, 'qonto-tx-1', {})
    expect(db.bankTransaction.findFirst.mock.calls[0][0]?.where).toEqual({
      bankAccount: { bankConnection: { companyId: COMPANY } },
      externalTransactionId: 'qonto-tx-1',
    })
    expect(calls[0].pathname).toBe(`/v2/transactions/${TX_UUID}/attachments`)
  })

  it('refuses an empty reference and a transaction that is not a Qonto operation', async () => {
    stubQonto({})
    await expect(listQontoTransactionAttachments(COMPANY, '', {})).rejects.toThrow(new ValidationError('Identifiant de transaction invalide.'))
    db.bankTransaction.findFirst.mockResolvedValue({ providerData: { id: 'ponto-id' } })
    await expect(listQontoTransactionAttachments(COMPANY, 'ponto-1', {})).rejects.toThrow(
      new NotFoundError("Cette transaction n'est pas une opération Qonto."),
    )
    db.bankTransaction.findFirst.mockResolvedValue({ providerData: null })
    await expect(listQontoTransactionAttachments(COMPANY, 'import-1', {})).rejects.toThrow(new NotFoundError('Transaction introuvable'))
    expect(calls).toEqual([])
  })
})

describe('readQontoReceipt', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    externalAttachmentId: 'qa-1',
    transactionUuid: null,
    fileName: 'facture.pdf',
    fileContentType: 'application/pdf',
    fileUrl: 'https://files.qonto.com/stored.pdf',
    bankTransaction: { externalTransactionId: TX_UUID },
    ...over,
  })

  it('finds the attachment by Kledg id or Qonto id within the company', async () => {
    db.attachment.findFirst.mockResolvedValue({ companyId: COMPANY })
    expect(await companyOfQontoAttachment('qa-1')).toEqual({ companyId: COMPANY })
    expect(db.attachment.findFirst.mock.calls[0][0]).toEqual({
      where: { OR: [{ id: 'qa-1' }, { externalAttachmentId: 'qa-1' }] },
      select: { companyId: true },
    })
  })

  it('downloads the fresh Qonto URL, with its name and type, rather than the stored one', async () => {
    db.attachment.findFirst.mockResolvedValue(stored())
    stubQonto({
      '/attachments': ok({ attachments: [{ id: 'other' }, { id: 'qa-1', url: 'https://files.qonto.com/fresh.png', file_name: 'ticket.png', file_content_type: 'image/png' }] }),
      '/fresh.png': () => new Response('PNG', { status: 200 }),
    })
    const receipt = await readQontoReceipt(COMPANY, 'qa-1')
    expect(new TextDecoder().decode(receipt.body)).toBe('PNG')
    expect(receipt).toMatchObject({ contentType: 'image/png', fileName: 'ticket.png' })
    expect(db.attachment.findFirst.mock.calls[0][0]?.where).toEqual({ OR: [{ id: 'qa-1' }, { externalAttachmentId: 'qa-1' }], companyId: COMPANY })
    expect(calls.map((u) => u.pathname)).toEqual([`/v2/transactions/${TX_UUID}/attachments`, '/fresh.png'])
  })

  it('falls back to the stored URL when Qonto no longer lists the receipt', async () => {
    db.attachment.findFirst.mockResolvedValue(stored({ transactionUuid: TX_UUID, fileContentType: null, fileName: '' }))
    stubQonto({ '/attachments': ok({ attachments: [] }), '/stored.pdf': () => new Response('%PDF', { status: 200 }) })
    const receipt = await readQontoReceipt(COMPANY, 'qa-1')
    expect(new TextDecoder().decode(receipt.body)).toBe('%PDF')
    expect(receipt).toMatchObject({ contentType: 'application/pdf', fileName: 'justificatif' })
  })

  it('answers 404 when neither Qonto nor the attachment has a file', async () => {
    db.attachment.findFirst.mockResolvedValue(stored({ fileUrl: null, externalAttachmentId: null }))
    stubQonto({})
    await expect(readQontoReceipt(COMPANY, 'qa-1')).rejects.toThrow(new NotFoundError('Justificatif introuvable ou fichier non disponible'))
    expect(calls).toEqual([])
  })

  it('reads a receipt not synced yet only through a transaction of the company', async () => {
    db.attachment.findFirst.mockResolvedValue(null)
    db.bankTransaction.findFirst.mockResolvedValue({ id: 'bt-1' })
    stubQonto({
      '/attachments': ok({ attachments: [{ id: 'qa-9', url: 'https://files.qonto.com/qa-9.pdf', file_name: '', file_content_type: '' }] }),
      '/qa-9.pdf': () => new Response('%PDF-9', { status: 200 }),
    })
    const receipt = await readQontoReceipt(COMPANY, 'qa-9', TX_UUID)
    expect(receipt).toMatchObject({ contentType: 'application/pdf', fileName: 'justificatif' })
    expect(db.bankTransaction.findFirst.mock.calls[0][0]?.where).toEqual({
      externalTransactionId: TX_UUID,
      bankAccount: { bankConnection: { companyId: COMPANY } },
    })
  })
})
