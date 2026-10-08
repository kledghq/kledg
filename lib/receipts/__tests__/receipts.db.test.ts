/**
 * Receipts filed from a photo (lib/receipts, docs/justificatifs-photo.md)
 * against PostgreSQL:
 * - staging checks the bytes, stores the file once per content (dedup by
 *   SHA-256), and a discarded receipt can be staged again;
 * - matching finds the one transaction, proposes candidates, or none with
 *   the expense report Kledg would prepare, and never proposes a
 *   transaction that already has its receipt;
 * - attaching keeps the file in Kledg for a bank without receipt API (the
 *   Justificatifs page then counts it as provided, the receipt proxy serves
 *   it) or sends it to Qonto (stubbed) and drops Kledg's copy, once: a
 *   retry does nothing more;
 * - the expense action creates a brouillon for the month, adds the next
 *   receipt to that open brouillon, never submits it, and runs once;
 * - another company's receipt, or another member's, is "introuvable"; with
 *   KLEDG_RLS=enforce the database hides another company's rows too.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const qonto = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipts')
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { uploads: [] as Array<{ transactionId: string; name: string; type: string; size: number; key: string }>, fail: false }
})

vi.mock('@/lib/integrations/providers/qonto/sync-attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/integrations/providers/qonto/sync-attachments')>()),
  // Qonto's attachments API, stubbed: records the upload and copies the receipt back like the real sync.
  uploadQontoReceipt: async (companyId: string, transactionId: string, file: File, key: string) => {
    if (qonto.fail) throw new Error('Qonto down')
    qonto.uploads.push({ transactionId, name: file.name, type: file.type, size: file.size, key })
    const { prisma } = await import('@/lib/prisma')
    await prisma.attachment.create({ data: { companyId, bankTransactionId: transactionId, externalAttachmentId: `qonto-${qonto.uploads.length}`, fileName: file.name, fileContentType: file.type } })
    return { receipts: 1 }
  },
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { prisma } from '@/lib/prisma'
import { rlsMode } from '@/lib/rls/mode'
import { withUserContext } from '@/lib/rls/context'
import { discardStagedReceipt, findStagedReceipt, listPendingReceipts, purgeExpiredReceipts, stageReceipt, type StagedReceiptActor } from '../stage-receipt.service'
import { attachStagedReceipt, expenseFromStagedReceipt, matchStagedReceipt, previewAttachReceipt, ReceiptFieldsSchema } from '../file-receipt.service'
import { listMissingReceipts, MissingReceiptsQuerySchema } from '@/lib/banking/missing-receipts.service'
import { readQontoReceipt } from '@/lib/integrations/providers/qonto/read-qonto-attachments.service'
import { HEIC, PDF, jpegWith } from './fixtures'

const available = await testDatabaseAvailable()

const ids = {} as Record<string, string>
const OWNER: StagedReceiptActor = { userId: 'u-owner', seesAll: true }
const VIEWER: StagedReceiptActor = { userId: 'u-viewer', seesAll: false }
const viewerExpense = { userId: 'u-viewer', userName: 'Viewer', canManage: false }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const fields = (over: Record<string, unknown> = {}) => ReceiptFieldsSchema.parse({ amountCents: 4_350, date: '2026-10-03', merchant: 'Boulangerie du Marché', ...over })

async function seedCompany(prefix: 'a' | 'b', provider: 'MANUAL' | 'QONTO') {
  const company = await prisma.company.create({ data: { name: `Société ${prefix}`, slug: `societe-${prefix}`, siren: prefix === 'a' ? '123456782' : '222222222' } })
  await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider, login: `l-${prefix}` } })
  const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${prefix}`, name: `Compte ${prefix}` } })
  const tx = (ext: string, amount: number, date: string, label: string) =>
    prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId: `${prefix}-${ext}`, amount, date: day(date), side: 'debit', label }, select: { id: true } })
  ids[`${prefix}Company`] = company.id
  ids[`${prefix}Bakery`] = (await tx('bakery', 43.5, '2026-10-04', 'CB BOULANGERIE DU MARCHE 03/10')).id
  ids[`${prefix}Twin1`] = (await tx('twin1', 18, '2026-10-05', 'CB PARKING INDIGO')).id
  ids[`${prefix}Twin2`] = (await tx('twin2', 18, '2026-10-06', 'CB PARKING SAEMES')).id
  ids[`${prefix}Done`] = (await tx('done', 99, '2026-10-03', 'CB FNAC')).id
  await prisma.attachment.create({ data: { companyId: company.id, bankTransactionId: ids[`${prefix}Done`], externalAttachmentId: `att-${prefix}`, fileName: 'fnac.pdf' } })
  await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
}

describe.skipIf(!available)('receipts filed from a photo', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipts')
    for (const [id, email] of [
      ['u-owner', 'owner@test.local'],
      ['u-viewer', 'viewer@test.local'],
    ]) await prisma.user.create({ data: { id, email, name: id } })
    await seedCompany('a', 'MANUAL')
    await seedCompany('b', 'QONTO')
    for (const prefix of ['a', 'b']) {
      await prisma.member.create({ data: { id: `m-${prefix}-owner`, organizationId: `org-${prefix}`, userId: 'u-owner', role: 'companyAdmin', createdAt: new Date() } })
    }
    await prisma.member.create({ data: { id: 'm-a-viewer', organizationId: 'org-a', userId: 'u-viewer', role: 'viewer', createdAt: new Date() } })
  })

  afterEach(() => {
    qonto.fail = false
  })

  describe('staging', () => {
    it('stores a JPEG once per content, with its real type and the uploader', async () => {
      const first = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('one'), fileName: 'IMG_0001.HEIC', source: 'view' })
      expect(first.duplicate).toBe(false)
      expect(first.receipt).toMatchObject({ status: 'staged', fileName: 'IMG_0001.jpg', contentType: 'image/jpeg', source: 'view', hasFile: true })
      const again = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('one'), fileName: 'autre.jpg', source: 'base64' })
      expect(again).toMatchObject({ duplicate: true, receipt: { id: first.receipt.id, fileName: 'IMG_0001.jpg' } })
      expect(await prisma.receiptFile.count({ where: { companyId: ids.aCompany } })).toBe(1)
      const row = await prisma.stagedReceipt.findUniqueOrThrow({ where: { id: first.receipt.id } })
      expect(row.uploadedById).toBe('u-viewer')
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(29 * 86_400_000)
    })

    it('refuses what is not a JPEG, PNG or PDF, and HEIC with what to do', async () => {
      await expect(stageReceipt(ids.aCompany, VIEWER, { bytes: HEIC, fileName: 'IMG.HEIC', source: 'base64' })).rejects.toThrow(/HEIC/)
      await expect(stageReceipt(ids.aCompany, VIEWER, { bytes: new Uint8Array(Buffer.from('<svg onload=x>')), fileName: 'x.pdf', source: 'base64' })).rejects.toThrow('Type de fichier non accepté')
    })

    it("keeps another member's receipt out of reach, and a validator's in reach", async () => {
      const own = await stageReceipt(ids.aCompany, OWNER, { bytes: jpegWith('owner-only'), fileName: 'x.jpg', source: 'app' })
      await expect(findStagedReceipt(ids.aCompany, own.receipt.id, VIEWER)).rejects.toThrow('Justificatif introuvable')
      await expect(stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('owner-only'), fileName: 'x.jpg', source: 'app' })).rejects.toThrow('déjà été déposé par un autre membre')
      expect((await findStagedReceipt(ids.aCompany, own.receipt.id, OWNER)).id).toBe(own.receipt.id)
      // Another company's id: not found
      await expect(findStagedReceipt(ids.bCompany, own.receipt.id, OWNER)).rejects.toThrow('Justificatif introuvable')
      expect((await listPendingReceipts(ids.aCompany, VIEWER)).map((r) => r.id)).not.toContain(own.receipt.id)
    })

    it('discards a receipt, deletes its file, and stages it again from scratch', async () => {
      const staged = await stageReceipt(ids.aCompany, VIEWER, { bytes: PDF, fileName: 'ticket.pdf', source: 'app' })
      await matchStagedReceipt(ids.aCompany, staged.receipt.id, VIEWER, fields({ amountCents: 777 }))
      const discarded = await discardStagedReceipt(ids.aCompany, staged.receipt.id, VIEWER)
      expect(discarded).toMatchObject({ status: 'discarded', hasFile: false })
      expect(await prisma.receiptFile.count({ where: { companyId: ids.aCompany, sha256: staged.receipt.sha256 } })).toBe(0)
      const again = await stageReceipt(ids.aCompany, VIEWER, { bytes: PDF, fileName: 'ticket.pdf', source: 'app' })
      expect(again).toMatchObject({ duplicate: false, receipt: { id: staged.receipt.id, status: 'staged', hasFile: true, fields: { amountCents: null } } })
    })

    it('deletes unclaimed receipts after 30 days with their files, never a filed one', async () => {
      const old = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('old'), fileName: 'old.jpg', source: 'app' })
      const later = new Date(Date.now() + 31 * 86_400_000)
      const purged = await purgeExpiredReceipts(ids.aCompany, later)
      expect(purged.receipts).toBeGreaterThanOrEqual(1)
      expect(await prisma.stagedReceipt.count({ where: { id: old.receipt.id } })).toBe(0)
      expect(await prisma.receiptFile.count({ where: { companyId: ids.aCompany, sha256: old.receipt.sha256 } })).toBe(0)
      expect(await prisma.stagedReceipt.count({ where: { companyId: ids.aCompany, status: { in: ['attached', 'expense'] }, expiresAt: { lt: later } }, })).toBe(await prisma.stagedReceipt.count({ where: { companyId: ids.aCompany, status: { in: ['attached', 'expense'] } } }))
    })
  })

  describe('matching', () => {
    it('matches the one transaction with the amount, the date and the merchant', async () => {
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('bakery'), fileName: 'b.jpg', source: 'view' })
      const result = await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields())
      expect(result.outcome).toBe('matched')
      expect(result.match).toMatchObject({ transactionId: ids.aBakery, amountCents: 4_350, date: '2026-10-04', sendsToBank: false, reasons: ['Montant identique', 'Débitée 1 jour après', 'Même commerçant'] })
      expect(result.receipt.fields).toMatchObject({ amountCents: 4_350, currency: 'EUR', date: '2026-10-03', merchant: 'Boulangerie du Marché' })
      ids.bakeryReceipt = receipt.id
    })

    it('proposes candidates when two transactions are as likely', async () => {
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('parking'), fileName: 'p.jpg', source: 'view' })
      const result = await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields({ amountCents: 1_800, date: '2026-10-05', merchant: 'Parking' }))
      expect(result.outcome).toBe('candidates')
      expect(result.candidates.map((c) => c.transactionId)).toEqual([ids.aTwin1, ids.aTwin2])
      expect(result.expenseProposal).not.toBeNull()
    })

    it('finds none (and proposes the expense report) without a transaction, never one that has its receipt', async () => {
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('fnac'), fileName: 'f.jpg', source: 'view' })
      const result = await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields({ amountCents: 9_900, merchant: 'Fnac' }))
      expect(result.outcome).toBe('none')
      expect(result.reason).toBe('no_candidate')
      expect(result.expenseProposal).toMatchObject({ date: '2026-10-03', merchant: 'Fnac', amountCents: 9_900, category: 'OTHER', openDraft: null, needsEuroAmount: false })
    })

    it('uses the keyword rules of the company for the category, and asks for the fields', async () => {
      await prisma.expenseCategoryRule.create({ data: { companyId: ids.aCompany, keyword: 'restaurant', category: 'MEALS', priority: 1 } })
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('resto'), fileName: 'r.jpg', source: 'view' })
      await expect(matchStagedReceipt(ids.aCompany, receipt.id, VIEWER)).rejects.toThrow('Indiquez le montant TTC et la date')
      const result = await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields({ amountCents: 2_640, merchant: 'Restaurant Le Zinc', paymentHint: 'personal_card', vatLines: [{ rateBp: 1000, amountCents: 240 }] }))
      expect(result).toMatchObject({ outcome: 'none', reason: 'personal_payment', expenseProposal: { category: 'MEALS', accountCode: '6256' } })
      ids.restoReceipt = receipt.id
    })
  })

  describe('attaching', () => {
    it('previews, then keeps the file in Kledg for a bank without receipt API, once', async () => {
      const preview = await previewAttachReceipt(ids.aCompany, ids.bakeryReceipt, VIEWER, ids.aBakery)
      expect(preview).toMatchObject({ destination: 'kledg', alreadyAttached: false, transaction: { transactionId: ids.aBakery, receipts: 0 } })
      expect(await prisma.attachment.count({ where: { bankTransactionId: ids.aBakery } })).toBe(0)

      const before = await listMissingReceipts(ids.aCompany, MissingReceiptsQuerySchema.parse({ side: 'debit' }))
      expect(before.transactions.map((t) => t.id)).toContain(ids.aBakery)

      const done = await attachStagedReceipt(ids.aCompany, ids.bakeryReceipt, VIEWER, ids.aBakery)
      expect(done).toMatchObject({ destination: 'kledg', alreadyAttached: false, receipts: 1, receipt: { status: 'attached', bankTransactionId: ids.aBakery, hasFile: true } })
      const again = await attachStagedReceipt(ids.aCompany, ids.bakeryReceipt, VIEWER, ids.aBakery)
      expect(again).toMatchObject({ alreadyAttached: true, receipts: 1 })
      await expect(attachStagedReceipt(ids.aCompany, ids.bakeryReceipt, VIEWER, ids.aTwin1)).rejects.toThrow('déjà rattaché à une autre transaction')

      // Justificatifs counts it as provided; the receipt proxy serves the stored bytes, without any bank call
      const after = await listMissingReceipts(ids.aCompany, MissingReceiptsQuerySchema.parse({ side: 'debit' }))
      expect(after.transactions.map((t) => t.id)).not.toContain(ids.aBakery)
      const attachment = await prisma.attachment.findFirstOrThrow({ where: { bankTransactionId: ids.aBakery } })
      const file = await readQontoReceipt(ids.aCompany, attachment.id)
      expect(Buffer.from(file.body).equals(Buffer.from(jpegWith('bakery')))).toBe(true)
      expect(file.contentType).toBe('image/jpeg')
      // A matched transaction now has its receipt: it is no candidate any more
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('bakery-2'), fileName: 'b2.jpg', source: 'view' })
      expect((await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields())).outcome).not.toBe('matched')
    })

    it('sends the file to Qonto with a stable idempotency key, drops its copy, and gives it back on failure', async () => {
      const { receipt } = await stageReceipt(ids.bCompany, OWNER, { bytes: jpegWith('qonto'), fileName: 'q.jpg', source: 'file_param' })
      await matchStagedReceipt(ids.bCompany, receipt.id, OWNER, fields())
      expect((await previewAttachReceipt(ids.bCompany, receipt.id, OWNER, ids.bBakery)).destination).toBe('qonto')

      qonto.fail = true
      await expect(attachStagedReceipt(ids.bCompany, receipt.id, OWNER, ids.bBakery)).rejects.toThrow('Qonto down')
      expect((await findStagedReceipt(ids.bCompany, receipt.id, OWNER)).status).toBe('staged')

      qonto.fail = false
      const done = await attachStagedReceipt(ids.bCompany, receipt.id, OWNER, ids.bBakery)
      expect(done).toMatchObject({ destination: 'qonto', receipt: { status: 'attached', hasFile: false } })
      expect(qonto.uploads).toEqual([{ transactionId: ids.bBakery, name: 'q.jpg', type: 'image/jpeg', size: jpegWith('qonto').length, key: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) }])
      expect(await prisma.receiptFile.count({ where: { companyId: ids.bCompany, sha256: receipt.sha256 } })).toBe(0)
      // Retried: nothing is sent again
      expect((await attachStagedReceipt(ids.bCompany, receipt.id, OWNER, ids.bBakery)).alreadyAttached).toBe(true)
      expect(qonto.uploads).toHaveLength(1)
      // The same photo staged again answers it was filed
      expect(await stageReceipt(ids.bCompany, OWNER, { bytes: jpegWith('qonto'), fileName: 'q.jpg', source: 'view' })).toMatchObject({ duplicate: true, receipt: { status: 'attached' } })
    })
  })

  describe('expense report', () => {
    it('creates a brouillon for the month with the receipt attached, never submitted, once', async () => {
      const result = await expenseFromStagedReceipt(ids.aCompany, ids.restoReceipt, VIEWER, viewerExpense, {}, { source: 'mcp' })
      expect(result).toMatchObject({ created: true, alreadyDone: false, lines: 1, totalOwedCents: 2_640, receipt: { status: 'expense' } })
      const report = await prisma.expenseReport.findUniqueOrThrow({ where: { id: result.reportId }, include: { lines: { include: { receiptAttachment: true } }, claimant: true } })
      expect(report.status).toBe('DRAFT')
      expect(report.claimant.userId).toBe('u-viewer')
      expect([report.periodStart.toISOString().slice(0, 10), report.periodEnd.toISOString().slice(0, 10)]).toEqual(['2026-10-01', '2026-10-31'])
      expect(report.lines[0]).toMatchObject({ supplierName: 'Restaurant Le Zinc', category: 'MEALS', vatRateBp: 1000, receiptKind: 'RECEIPT' })
      expect(report.lines[0].receiptAttachment?.receiptFileId).toBeTruthy()
      const again = await expenseFromStagedReceipt(ids.aCompany, ids.restoReceipt, VIEWER, viewerExpense)
      expect(again).toMatchObject({ alreadyDone: true, reportId: result.reportId })
      expect(await prisma.expenseLine.count({ where: { reportId: result.reportId } })).toBe(1)
      ids.viewerReport = result.reportId
    })

    it("adds the next receipt to the user's open brouillon of the month, one line per VAT rate", async () => {
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('two-rates'), fileName: 't.jpg', source: 'view' })
      await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields({ amountCents: 3_300, date: '2026-10-08', merchant: 'Épicerie', paymentHint: 'cash', vatLines: [{ rateBp: 550, amountCents: 52 }, { rateBp: 2000, amountCents: 384 }] }))
      const result = await expenseFromStagedReceipt(ids.aCompany, receipt.id, VIEWER, viewerExpense)
      expect(result).toMatchObject({ created: false, reportId: ids.viewerReport, lines: 3, totalOwedCents: 2_640 + 3_300 })
      const lines = await prisma.expenseLine.findMany({ where: { reportId: ids.viewerReport }, orderBy: { position: 'asc' } })
      expect(lines.map((l) => [l.vatRateBp, Number(l.vatAmount), Number(l.amountInclTax)])).toEqual([
        [1000, 2.4, 26.4],
        [550, 0.52, 9.97],
        [2000, 3.84, 23.03],
      ])
    })

    it('starts a new brouillon when the open one cannot take the line (a line of it to fix)', async () => {
      const claimant = await prisma.expenseClaimant.findFirstOrThrow({ where: { companyId: ids.aCompany, userId: 'u-viewer' } })
      const broken = await prisma.expenseReport.create({
        data: {
          companyId: ids.aCompany,
          claimantId: claimant.id,
          number: 'NDF-0900',
          periodStart: day('2026-11-01'),
          periodEnd: day('2026-11-30'),
          totalInclTax: 10,
          recoverableVat: 0,
          totalExpense: 10,
          lines: { create: [{ position: 1, date: day('2026-11-02'), label: 'Ancienne ligne', category: 'OTHER', accountCode: '706000', amountInclTax: 10 }] },
        },
      })
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('november'), fileName: 'n.jpg', source: 'view' })
      await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields({ amountCents: 1_500, date: '2026-11-05', merchant: 'Taxi', paymentHint: 'cash' }))
      const result = await expenseFromStagedReceipt(ids.aCompany, receipt.id, VIEWER, viewerExpense)
      expect(result.created).toBe(true)
      expect(result.reportId).not.toBe(broken.id)
      expect(await prisma.expenseLine.count({ where: { reportId: broken.id } })).toBe(1)
    })

    it('refuses a foreign currency receipt and one already attached', async () => {
      const { receipt } = await stageReceipt(ids.aCompany, VIEWER, { bytes: jpegWith('usd'), fileName: 'u.jpg', source: 'view' })
      await matchStagedReceipt(ids.aCompany, receipt.id, VIEWER, fields({ currency: 'usd', merchant: 'Diner NYC', paymentHint: 'personal_card' }))
      await expect(expenseFromStagedReceipt(ids.aCompany, receipt.id, VIEWER, viewerExpense)).rejects.toThrow('une note de frais est en euros')
      await expect(expenseFromStagedReceipt(ids.aCompany, ids.bakeryReceipt, VIEWER, viewerExpense)).rejects.toThrow('déjà rattaché')
    })
  })

  describe.runIf(rlsMode() === 'enforce')('row level security (KLEDG_RLS=enforce)', () => {
    it("hides another company's staged receipts and files from a member", async () => {
      const visible = await withUserContext('u-viewer', () => prisma.stagedReceipt.findMany({ select: { companyId: true } }))
      expect(new Set(visible.map((r) => r.companyId))).toEqual(new Set([ids.aCompany]))
      const files = await withUserContext('u-viewer', () => prisma.receiptFile.findMany({ select: { companyId: true } }))
      expect(files.every((f) => f.companyId === ids.aCompany)).toBe(true)
      expect(await prisma.stagedReceipt.count({ where: { companyId: ids.bCompany } })).toBeGreaterThan(0)
    })
  })
})
