/**
 * Receipt files in object storage (lib/storage, lib/receipts/receipt-file-
 * store.ts) against PostgreSQL, with the filesystem driver in a temporary
 * directory:
 * - staging writes the object under the company's prefix, never the bytes in
 *   the row; the same content is one object per company;
 * - the receipt proxy (readQontoReceipt, behind GET /api/banking/attachments/
 *   [id]/proxy and get_file) serves the object, and refuses one changed in
 *   storage;
 * - discarding, the 30 day purge, sending to Qonto and deleting the company
 *   delete the objects;
 * - `pnpm receipts:migrate-storage` moves database bytes to the driver after
 *   checking the SHA-256, resumes after a failure, does nothing twice, and
 *   moves back to the database;
 * - an expense receipt is handed to Qonto (opt in, validated reports only)
 *   and Kledg drops its copy only once Qonto serves the same bytes;
 * - the database refuses a key outside its company's prefix; with
 *   KLEDG_RLS=enforce a member still sees only their company's files.
 *
 * Skipped when the test database server is unreachable.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const env = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_storage')
  process.env.RATE_LIMIT_DISABLED = 'true'
  const { mkdtempSync: mk } = await import('node:fs')
  const { tmpdir: tmp } = await import('node:os')
  const dir = mk(`${tmp()}/kledg-receipt-storage-`)
  process.env.KLEDG_STORAGE_DIR = dir
  delete process.env.KLEDG_STORAGE_DRIVER
  delete process.env.BLOB_READ_WRITE_TOKEN
  delete process.env.BLOB_STORE_ID
  delete process.env.KLEDG_S3_BUCKET
  return { dir, qontoFiles: new Map<string, Uint8Array>() }
})

vi.mock('@/lib/integrations/providers/qonto/sync-attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/providers/qonto/sync-attachments')>()),
  uploadQontoReceipt: async (companyId: string, transactionId: string, file: File) => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.attachment.create({ data: { companyId, bankTransactionId: transactionId, externalAttachmentId: `qonto-${transactionId}`, fileName: file.name } })
    return { receipts: 1 }
  },
}))

// Qonto's attachments API for a receipt stored there as a supplier invoice (readQontoReceipt).
vi.mock('@/lib/integrations/providers/qonto/get-credentials', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/providers/qonto/get-credentials')>()),
  getQontoCredentials: async () => ({ login: 'org', secretKey: 'key' }),
}))
vi.mock('@/lib/integrations/providers/qonto/invoicing', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/providers/qonto/invoicing')>()
  class QontoInvoicing extends original.QontoInvoicing {
    async getAttachmentFile(id: string) {
      return env.qontoFiles.has(id) ? { url: `https://qonto.test/${id}`, file_name: 'ticket.jpg', file_content_type: 'image/jpeg' } : null
    }
  }
  return { ...original, QontoInvoicing }
})
vi.mock('@/lib/integrations/providers/qonto/files', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/providers/qonto/files')>()),
  fetchQontoFile: async (url: string) => {
    const bytes = env.qontoFiles.get(url.split('/').pop()!)!
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  },
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { prisma } from '@/lib/prisma'
import { rlsMode } from '@/lib/rls/mode'
import { withUserContext } from '@/lib/rls/context'
import { setObjectStorageForTests, objectStorage, type ObjectStorage } from '@/lib/storage'
import { discardStagedReceipt, purgeExpiredReceipts, stageReceipt, type StagedReceiptActor } from '../stage-receipt.service'
import { attachStagedReceipt, expenseFromStagedReceipt, matchStagedReceipt, ReceiptFieldsSchema } from '../file-receipt.service'
import { migrateReceiptStorage } from '../migrate-receipt-storage.service'
import { offloadExpenseReceiptsToQonto, supplierInvoiceKey, type QontoReceiptStore } from '../offload-to-qonto.service'
import { sha256Hex } from '../receipt-file-store'
import { readQontoReceipt } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'
import { deleteCompany } from '@/lib/companies/archive-company.service'
import { jpegWith, PDF } from './fixtures'

const available = await testDatabaseAvailable()

const ids = {} as Record<string, string>
const OWNER: StagedReceiptActor = { userId: 'u-owner', seesAll: true }
const ownerExpense = { userId: 'u-owner', userName: 'Owner', canManage: true }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const fields = (over: Record<string, unknown> = {}) => ReceiptFieldsSchema.parse({ amountCents: 4_350, date: '2026-10-03', merchant: 'Boulangerie du Marché', ...over })
const objectFile = (key: string) => path.join(env.dir, key)
const objectsOf = async (companyId: string) => readdir(path.join(env.dir, 'receipts', companyId)).catch(() => [] as string[])

async function seedCompany(prefix: string, provider: 'MANUAL' | 'QONTO') {
  const company = await prisma.company.create({ data: { name: `Société ${prefix}`, slug: `societe-${prefix}`, siren: { a: '123456782', b: '222222222', c: '444444444' }[prefix] ?? '555555555' } })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  await prisma.member.create({ data: { id: `m-${prefix}`, organizationId: `org-${prefix}`, userId: 'u-owner', role: 'companyAdmin', createdAt: new Date() } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider, login: `l-${prefix}` } })
  const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${prefix}`, name: `Compte ${prefix}` } })
  const tx = await prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId: `${prefix}-bakery`, amount: 43.5, date: day('2026-10-04'), side: 'debit', label: 'CB BOULANGERIE DU MARCHE 03/10' } })
  await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Bakery`] = tx.id
  return company.id
}

/** A storage that fails its `failAt`-th put (counted from 1), then works. */
function flakyStorage(inner: ObjectStorage, failAt: number): ObjectStorage {
  let puts = 0
  return { ...inner, driver: inner.driver, put: async (...args) => (++puts === failAt ? Promise.reject(new Error('bucket unavailable')) : inner.put(...args)) }
}

describe.skipIf(!available)('receipt files in object storage', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipt_storage')
    await prisma.user.create({ data: { id: 'u-owner', email: 'owner@test.local', name: 'Owner' } })
    await seedCompany('a', 'MANUAL')
    await seedCompany('b', 'QONTO')
  })

  afterEach(() => {
    delete process.env.KLEDG_STORAGE_DRIVER
    delete process.env.KLEDG_QONTO_EXPENSE_RECEIPTS
    setObjectStorageForTests('fs', null)
  })

  it('stages into the configured storage: one object per content and company, no bytes in the row', async () => {
    const first = await stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith('one'), fileName: 'one.jpg', source: 'app' })
    const again = await stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith('one'), fileName: 'one.jpg', source: 'app' })
    expect(again.duplicate).toBe(true)
    const other = await stageReceipt(ids.bCompany, OWNER, { bytes: jpegWith('one'), fileName: 'one.jpg', source: 'app' })
    const [a, b] = await Promise.all([
      prisma.receiptFile.findFirstOrThrow({ where: { companyId: ids.aCompany, sha256: first.receipt.sha256 } }),
      prisma.receiptFile.findFirstOrThrow({ where: { companyId: ids.bCompany, sha256: other.receipt.sha256 } }),
    ])
    expect(a).toMatchObject({ storageDriver: 'fs', content: null })
    expect(a.storageKey).toMatch(new RegExp(`^receipts/${ids.aCompany}/[A-Za-z0-9_-]{32}$`))
    expect(b.storageKey).toMatch(new RegExp(`^receipts/${ids.bCompany}/`))
    expect(a.storageKey).not.toContain(first.receipt.sha256)
    expect(new Uint8Array(await readFile(objectFile(a.storageKey!)))).toEqual(jpegWith('one'))
    expect(await objectsOf(ids.aCompany)).toHaveLength(1)
  })

  it('serves an attached receipt through the receipt proxy, and refuses an object changed in storage', async () => {
    const { receipt } = await stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith('bakery'), fileName: 'b.jpg', source: 'app' })
    await matchStagedReceipt(ids.aCompany, receipt.id, OWNER, fields())
    await attachStagedReceipt(ids.aCompany, receipt.id, OWNER, ids.aBakery)
    const attachment = await prisma.attachment.findFirstOrThrow({ where: { companyId: ids.aCompany, bankTransactionId: ids.aBakery }, include: { receiptFile: true } })
    const served = await readQontoReceipt(ids.aCompany, attachment.id)
    expect(new Uint8Array(served.body)).toEqual(jpegWith('bakery'))
    expect(served.contentType).toBe('image/jpeg')
    // Another company's attachment id: not found.
    await expect(readQontoReceipt(ids.bCompany, attachment.id)).rejects.toThrow()
    // Same size, other bytes: the SHA-256 check refuses it.
    const file = objectFile(attachment.receiptFile!.storageKey!)
    const original = await readFile(file)
    await writeFile(file, Buffer.from(original).fill(0x41, original.length - 2))
    await expect(readQontoReceipt(ids.aCompany, attachment.id)).rejects.toThrow('Justificatif')
    await writeFile(file, original)
  })

  it('deletes the object when a receipt is discarded, purged after 30 days, or sent to Qonto', async () => {
    const discarded = await stageReceipt(ids.aCompany, OWNER, { bytes: PDF, fileName: 'd.pdf', source: 'app' })
    const key = (await prisma.receiptFile.findFirstOrThrow({ where: { companyId: ids.aCompany, sha256: discarded.receipt.sha256 } })).storageKey!
    await discardStagedReceipt(ids.aCompany, discarded.receipt.id, OWNER)
    expect(await objectStorage('fs').exists(key)).toBe(false)

    const old = await stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith('old'), fileName: 'o.jpg', source: 'app' })
    const oldKey = (await prisma.receiptFile.findFirstOrThrow({ where: { companyId: ids.aCompany, sha256: old.receipt.sha256 } })).storageKey!
    await purgeExpiredReceipts(ids.aCompany, new Date(Date.now() + 31 * 86_400_000))
    expect(await objectStorage('fs').exists(oldKey)).toBe(false)

    const toQonto = await stageReceipt(ids.bCompany, OWNER, { bytes: jpegWith('qonto'), fileName: 'q.jpg', source: 'app' })
    const qontoKey = (await prisma.receiptFile.findFirstOrThrow({ where: { companyId: ids.bCompany, sha256: toQonto.receipt.sha256 } })).storageKey!
    await matchStagedReceipt(ids.bCompany, toQonto.receipt.id, OWNER, fields())
    await attachStagedReceipt(ids.bCompany, toQonto.receipt.id, OWNER, ids.bBakery)
    expect(await objectStorage('fs').exists(qontoKey)).toBe(false)
    expect(await prisma.receiptFile.count({ where: { storageKey: qontoKey } })).toBe(0)
  })

  it('removes nothing when the object cannot be written: no row, no leftover object', async () => {
    setObjectStorageForTests('fs', flakyStorage(objectStorage('fs'), 1))
    const before = await objectsOf(ids.aCompany)
    await expect(stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith('unwritable'), fileName: 'u.jpg', source: 'app' })).rejects.toThrow('bucket unavailable')
    expect(await prisma.receiptFile.count({ where: { companyId: ids.aCompany, sha256: sha256Hex(jpegWith('unwritable')) } })).toBe(0)
    expect(await objectsOf(ids.aCompany)).toEqual(before)
  })

  describe('pnpm receipts:migrate-storage', () => {
    it('moves database bytes to the driver after checking them, resumes, and never moves twice', async () => {
      process.env.KLEDG_STORAGE_DRIVER = 'postgres'
      const staged = []
      for (const seed of ['m1', 'm2', 'm3', 'm4']) staged.push(await stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith(seed), fileName: `${seed}.jpg`, source: 'app' }))
      const rows = await prisma.receiptFile.findMany({ where: { companyId: ids.aCompany, storageDriver: 'postgres' }, orderBy: { id: 'asc' } })
      expect(rows).toHaveLength(4)
      expect(rows.every((r) => r.content !== null && r.storageKey === null)).toBe(true)
      // One row whose bytes no longer match its SHA-256 (same size): reported, never moved.
      const corrupt = rows[3]
      await prisma.receiptFile.update({ where: { id: corrupt.id }, data: { content: new Uint8Array(corrupt.size).fill(0x42) } })

      process.env.KLEDG_STORAGE_DRIVER = 'fs'
      expect(await migrateReceiptStorage({ dryRun: true })).toMatchObject({ target: 'fs', pending: 4, moved: 0 })
      // The bucket fails on the second write: that file stays where it was.
      setObjectStorageForTests('fs', flakyStorage(objectStorage('fs'), 2))
      const first = await migrateReceiptStorage({ batchSize: 2 })
      expect(first).toMatchObject({ pending: 4, moved: 2, invalid: [corrupt.id] })
      expect(first.failed).toHaveLength(1)
      setObjectStorageForTests('fs', null)

      const second = await migrateReceiptStorage()
      expect(second).toMatchObject({ pending: 2, moved: 1, invalid: [corrupt.id], failed: [] })
      const third = await migrateReceiptStorage()
      expect(third).toMatchObject({ pending: 1, moved: 0, invalid: [corrupt.id] })

      for (const row of rows.slice(0, 3)) {
        const moved = await prisma.receiptFile.findUniqueOrThrow({ where: { id: row.id } })
        expect(moved).toMatchObject({ storageDriver: 'fs', content: null })
        expect(sha256Hex(new Uint8Array(await readFile(objectFile(moved.storageKey!))))).toBe(row.sha256)
      }
      expect(await prisma.receiptFile.findUniqueOrThrow({ where: { id: corrupt.id } })).toMatchObject({ storageDriver: 'postgres', storageKey: null })
      // Leftover of the failed write: none (the new object of a failed move is deleted).
      const keys = (await prisma.receiptFile.findMany({ where: { companyId: ids.aCompany, storageDriver: 'fs' }, select: { storageKey: true } })).map((r) => r.storageKey!.split('/')[2])
      expect((await objectsOf(ids.aCompany)).sort()).toEqual(keys.sort())
      await prisma.receiptFile.update({ where: { id: corrupt.id }, data: { content: new Uint8Array(jpegWith('m4')) } })
    })

    it('moves files back into the database and deletes their objects', async () => {
      process.env.KLEDG_STORAGE_DRIVER = 'postgres'
      const result = await migrateReceiptStorage({ companyId: ids.aCompany })
      expect(result.moved).toBe(result.pending)
      expect(await prisma.receiptFile.count({ where: { companyId: ids.aCompany, storageDriver: { not: 'postgres' } } })).toBe(0)
      expect(await objectsOf(ids.aCompany)).toEqual([])
      // And the proxy still serves them, from the database.
      const attachment = await prisma.attachment.findFirstOrThrow({ where: { companyId: ids.aCompany, bankTransactionId: ids.aBakery } })
      expect(new Uint8Array((await readQontoReceipt(ids.aCompany, attachment.id)).body)).toEqual(jpegWith('bakery'))
      process.env.KLEDG_STORAGE_DRIVER = 'fs'
      expect((await migrateReceiptStorage({ companyId: ids.aCompany })).failed).toEqual([])
    })
  })

  describe('expense receipts handed to Qonto (KLEDG_QONTO_EXPENSE_RECEIPTS=supplier_invoices)', () => {
    const uploads: string[] = []
    let served: (bytes: Uint8Array) => Uint8Array = (b) => b
    let refuse = false
    const store: QontoReceiptStore = {
      async upload(file, key) {
        uploads.push(key)
        if (refuse) return { kind: 'refused', codes: ['invalid'] }
        const id = `si-${key.slice(0, 8)}`
        env.qontoFiles.set(`att-${id}`, served(new Uint8Array(await file.arrayBuffer())))
        return { kind: 'created', invoiceId: id }
      },
      async readBack(invoiceId) {
        const bytes = env.qontoFiles.get(`att-${invoiceId}`)
        return bytes ? { attachmentId: `att-${invoiceId}`, bytes } : null
      },
    }

    async function expenseReceipt(seed: string) {
      const { receipt } = await stageReceipt(ids.bCompany, OWNER, { bytes: jpegWith(seed), fileName: `${seed}.jpg`, source: 'app' })
      await matchStagedReceipt(ids.bCompany, receipt.id, OWNER, fields({ amountCents: 1_200, merchant: 'Taxi', paymentHint: 'personal_card' }))
      const result = await expenseFromStagedReceipt(ids.bCompany, receipt.id, OWNER, ownerExpense)
      const attachment = await prisma.attachment.findFirstOrThrow({ where: { companyId: ids.bCompany, expenseLines: { some: { reportId: result.reportId } }, receiptFile: { sha256: receipt.sha256 } }, include: { receiptFile: true } })
      return { receipt, reportId: result.reportId, attachment }
    }

    it('does nothing unless the instance opts in, and never for a brouillon', async () => {
      const { reportId, attachment } = await expenseReceipt('taxi-draft')
      expect(await offloadExpenseReceiptsToQonto(ids.bCompany, { store })).toMatchObject({ sent: 0 })
      process.env.KLEDG_QONTO_EXPENSE_RECEIPTS = 'supplier_invoices'
      expect(await offloadExpenseReceiptsToQonto(ids.bCompany, { store })).toMatchObject({ sent: 0 })
      expect(uploads).toEqual([])
      expect((await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).receiptFileId).toBe(attachment.receiptFileId)
      ids.draftReport = reportId
    })

    it('sends a validated report receipt, reads it back, then drops Kledg copy; the proxy reads it from Qonto', async () => {
      process.env.KLEDG_QONTO_EXPENSE_RECEIPTS = 'supplier_invoices'
      await prisma.expenseReport.update({ where: { id: ids.draftReport }, data: { status: 'VALIDATED' } })
      const attachment = await prisma.attachment.findFirstOrThrow({ where: { companyId: ids.bCompany, expenseLines: { some: { reportId: ids.draftReport } } }, include: { receiptFile: true } })
      const key = attachment.receiptFile!.storageKey!
      expect(await offloadExpenseReceiptsToQonto(ids.bCompany, { store })).toMatchObject({ sent: 1 })
      expect(uploads).toEqual([supplierInvoiceKey(ids.bCompany, attachment.receiptFile!.sha256)])
      expect(uploads[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      const after = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } })
      expect(after).toMatchObject({ receiptFileId: null, externalAttachmentId: expect.stringMatching(/^att-si-/), providerData: expect.objectContaining({ storedAt: 'qonto_supplier_invoice' }) })
      expect(await prisma.receiptFile.count({ where: { id: attachment.receiptFileId! } })).toBe(0)
      expect(await objectStorage('fs').exists(key)).toBe(false)
      expect(await prisma.stagedReceipt.count({ where: { companyId: ids.bCompany, attachmentId: attachment.id, fileId: { not: null } } })).toBe(0)
      const served = await readQontoReceipt(ids.bCompany, attachment.id)
      expect(new Uint8Array(served.body)).toEqual(jpegWith('taxi-draft'))
      // Again: nothing left to send.
      expect(await offloadExpenseReceiptsToQonto(ids.bCompany, { store })).toMatchObject({ sent: 0 })
      expect(uploads).toHaveLength(1)
    })

    it('keeps Kledg copy when Qonto refuses the file or serves other bytes', async () => {
      process.env.KLEDG_QONTO_EXPENSE_RECEIPTS = 'supplier_invoices'
      const { reportId, attachment } = await expenseReceipt('taxi-kept')
      await prisma.expenseReport.update({ where: { id: reportId }, data: { status: 'VALIDATED' } })
      refuse = true
      expect(await offloadExpenseReceiptsToQonto(ids.bCompany, { store })).toMatchObject({ refused: 1, sent: 0 })
      refuse = false
      served = (b) => new Uint8Array([...b, 0])
      expect(await offloadExpenseReceiptsToQonto(ids.bCompany, { store })).toMatchObject({ mismatch: 1, sent: 0 })
      served = (b) => b
      const kept = await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id }, include: { receiptFile: true } })
      expect(kept.receiptFileId).toBe(attachment.receiptFileId)
      expect(await objectStorage('fs').exists(kept.receiptFile!.storageKey!)).toBe(true)
    })
  })

  it('refuses in the database a key outside the company prefix, and bytes in two places', async () => {
    const sha = 'c'.repeat(64)
    await expect(prisma.receiptFile.create({ data: { companyId: ids.aCompany, sha256: sha, contentType: 'image/jpeg', size: 4, storageDriver: 'fs', storageKey: `receipts/${ids.bCompany}/${'x'.repeat(32)}` } })).rejects.toThrow()
    await expect(prisma.receiptFile.create({ data: { companyId: ids.aCompany, sha256: sha, contentType: 'image/jpeg', size: 4, storageDriver: 'fs', storageKey: `receipts/${ids.aCompany}/${'x'.repeat(32)}`, content: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) } })).rejects.toThrow()
    await expect(prisma.receiptFile.create({ data: { companyId: ids.aCompany, sha256: sha, contentType: 'image/jpeg', size: 4, storageDriver: 'postgres' } })).rejects.toThrow()
  })

  describe.runIf(rlsMode() === 'enforce')('row level security (KLEDG_RLS=enforce)', () => {
    it("keeps another company's file rows out of a member's reach", async () => {
      await prisma.user.create({ data: { id: 'u-solo', email: 'solo@test.local', name: 'Solo' } })
      await prisma.member.create({ data: { id: 'm-a-solo', organizationId: 'org-a', userId: 'u-solo', role: 'viewer', createdAt: new Date() } })
      const files = await withUserContext('u-solo', () => prisma.receiptFile.findMany({ select: { companyId: true, storageKey: true } }))
      expect(files.length).toBeGreaterThan(0)
      expect(files.every((f) => f.companyId === ids.aCompany)).toBe(true)
      expect(await prisma.receiptFile.count({ where: { companyId: ids.bCompany } })).toBeGreaterThan(0)
    })
  })

  it('deletes the objects of a deleted company', async () => {
    const id = await seedCompany('c', 'MANUAL')
    await stageReceipt(id, OWNER, { bytes: jpegWith('c1'), fileName: 'c1.jpg', source: 'app' })
    await stageReceipt(id, OWNER, { bytes: jpegWith('c2'), fileName: 'c2.jpg', source: 'app' })
    expect(await objectsOf(id)).toHaveLength(2)
    await deleteCompany(id, { id: 'u-owner', email: 'owner@test.local' })
    expect(await objectsOf(id)).toEqual([])
  })
})

