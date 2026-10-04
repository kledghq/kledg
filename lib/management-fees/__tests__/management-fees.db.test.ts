/**
 * Management fees against PostgreSQL (skipped without the server): the
 * holding and its subsidiaries (shareholding link, reachable companies
 * only), conventions checked in every company involved, the cost pool read
 * from validated entries of the period without the excluded accounts, the
 * revenue key from the subsidiaries' own books, the invoices created through
 * the invoice module (sales drafts in the holding, purchase drafts proposed
 * to the subsidiaries, nothing posted), retries and overlaps refused, and
 * the rights checked in each subsidiary before anything is written.
 * Fictitious companies and amounts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('management_fees')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { withUserContext } from '@/lib/rls/context'
import type { ConventionInput } from '../manage-conventions.service'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let conventions: typeof import('../manage-conventions.service')
let computing: typeof import('../compute-management-fees.service')
let billing: typeof import('../bill-management-fees.service')
let holdingMod: typeof import('../holding')
let accessMod: typeof import('../access')

const ACCOUNTANT = { id: 'u-acc', email: 'acc@test.local', name: 'Comptable groupe', role: 'user' }
const MIXED = { id: 'u-mixed', email: 'mixed@test.local', name: 'Comptable holding', role: 'user' }
type User = typeof ACCOUNTANT

describe.skipIf(!available)('management fees (PostgreSQL)', () => {
  let holding: Books
  let s1: Books
  let s2: Books
  let s3: Books
  let other: Books

  /** Runs `fn` as a request of the holding does: the user's context narrowed to the holding (companyRoute). */
  const asHolding = <T>(user: User, fn: (access: import('../access').GroupAccess) => Promise<T>) =>
    withUserContext(user.id, () => fn(accessMod.userGroupAccess(user)), { companyIds: [holding.companyId] })

  const entry = async (books: Books, date: string, code: string, amount: string, side: 'charge' | 'revenue', status: 'validated' | 'draft' = 'validated') => {
    const account = await prisma.account.findFirstOrThrow({ where: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code } })
    await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.OD,
      date,
      description: `${code} ${date}`,
      status,
      lines:
        side === 'charge'
          ? [
              { accountId: account.id, debit: amount, credit: '0' },
              { accountId: books.accounts['512000'], debit: '0', credit: amount },
            ]
          : [
              { accountId: books.accounts['512000'], debit: amount, credit: '0' },
              { accountId: account.id, debit: '0', credit: amount },
            ],
    })
  }

  const convention = (over: Partial<ConventionInput> = {}): ConventionInput => ({
    label: 'Convention d’animation 2026',
    pricing: 'COST_PLUS',
    markupBp: 500,
    costShareBp: 10000,
    costAccountPrefixes: ['6'],
    excludedAccountPrefixes: ['657', '6582', '66', '67', '686', '687', '695', '696', '697', '698', '699'],
    fixedAmountCents: null,
    allocationKey: 'REVENUE',
    vatRateBp: 2000,
    revenueAccountCode: '706000',
    expenseAccountCode: '6226',
    invoicePrefix: 'FG',
    startDate: '2026-01-01',
    endDate: null,
    notes: null,
    subsidiaries: [{ subsidiaryId: s1.companyId }, { subsidiaryId: s2.companyId }],
    ...over,
  })

  const Q1 = { periodStart: '2026-01-01', periodEnd: '2026-03-31' }

  beforeAll(async () => {
    await prepareTestDatabase('management_fees')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    conventions = await import('../manage-conventions.service')
    computing = await import('../compute-management-fees.service')
    billing = await import('../bill-management-fees.service')
    holdingMod = await import('../holding')
    accessMod = await import('../access')
  })

  beforeEach(async () => {
    await prepareTestDatabase('management_fees')
    holding = await seedBooks(prisma, svc, { siren: '931000012', slug: 'mf-holding' })
    s1 = await seedBooks(prisma, svc, { siren: '931000020', slug: 'mf-filiale-1' })
    s2 = await seedBooks(prisma, svc, { siren: '931000038', slug: 'mf-filiale-2' })
    s3 = await seedBooks(prisma, svc, { siren: '931000046', slug: 'mf-filiale-3' })
    other = await seedBooks(prisma, svc, { siren: '931000053', slug: 'mf-autre' })
    for (const [code, label] of [['6226', 'Honoraires'], ['695', 'Impôts sur les bénéfices'], ['6616', 'Intérêts bancaires']]) {
      await prisma.account.create({ data: { companyId: holding.companyId, fiscalYearId: holding.fiscalYearId, code, label } })
    }
    for (const sub of [s1, s2, s3]) {
      await prisma.shareholder.create({ data: { companyId: sub.companyId, type: 'LEGAL', sharePercentage: 80, companyShareholderId: holding.companyId } })
    }
    // Q1: 10 000,00 of pooled charges, income tax and interest left out; April and a draft never count
    await entry(holding, '2026-01-15', '6064', '2000.00', 'charge')
    await entry(holding, '2026-02-15', '6226', '8000.00', 'charge')
    await entry(holding, '2026-03-15', '695', '3000.00', 'charge')
    await entry(holding, '2026-03-20', '6616', '500.00', 'charge')
    await entry(holding, '2026-04-10', '6064', '1000.00', 'charge')
    await entry(holding, '2026-03-25', '6064', '999.00', 'charge', 'draft')
    // Revenue of the subsidiaries: 3 to 1
    await entry(s1, '2026-02-01', '706000', '30000.00', 'revenue')
    await entry(s2, '2026-02-01', '706000', '10000.00', 'revenue')

    for (const books of [holding, s1, s2, other]) await seedMembership(prisma, ACCOUNTANT.id, books.companyId, 'accountant')
    await seedMembership(prisma, MIXED.id, holding.companyId, 'accountant')
    await seedMembership(prisma, MIXED.id, s1.companyId, 'accountant')
    await seedMembership(prisma, MIXED.id, s2.companyId, 'viewer')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('holdings and subsidiaries', () => {
    it('lists the subsidiaries recording the holding as shareholder that the user may read, nothing else', async () => {
      const candidates = await asHolding(ACCOUNTANT, (access) => holdingMod.listSubsidiaryCandidates(holding.companyId, ACCOUNTANT, access))
      expect(candidates.map((c) => c.id).sort()).toEqual([s1.companyId, s2.companyId].sort())
      expect(candidates[0]).toMatchObject({ sharePercentage: '80' })
    })

    it('[KLEDG-SEC-017] lists candidates within the bound of the access only (an assistant grant), never the user\'s other companies', async () => {
      const bounded = (user: User) => ({ ...accessMod.userGroupAccess(user), companyIds: async () => [holding.companyId, s1.companyId] })
      const candidates = await withUserContext(ACCOUNTANT.id, () => holdingMod.listSubsidiaryCandidates(holding.companyId, ACCOUNTANT, bounded(ACCOUNTANT)), {
        companyIds: [holding.companyId],
      })
      expect(candidates.map((c) => c.id)).toEqual([s1.companyId])
    })

    it('[KLEDG-SEC-017] looks holdings up among the given companies only', async () => {
      const all = [holding, s1, s2, other].map((books) => books.companyId)
      expect(await holdingMod.listHoldingRefs(ACCOUNTANT, all)).toEqual(expect.arrayContaining([holding.companyId, 'mf-holding']))
      // The holding is not among the companies given, or none of its subsidiaries is.
      expect(await holdingMod.listHoldingRefs(ACCOUNTANT, [s1.companyId, s2.companyId, other.companyId])).toEqual([])
      expect(await holdingMod.listHoldingRefs(ACCOUNTANT, [holding.companyId, other.companyId])).toEqual([])
    })

    it('shows the navigation entry in the holding only', async () => {
      const refs = await holdingMod.listHoldingRefs(ACCOUNTANT, [holding, s1, s2, other].map((books) => books.companyId))
      expect(refs).toEqual(expect.arrayContaining([holding.companyId, 'mf-holding']))
      expect(refs).not.toContain(s1.companyId)
      expect(refs).not.toContain(other.companyId)
    })
  })

  describe('conventions', () => {
    it('refuses a subsidiary the user cannot reach, a company that is not a subsidiary, and shares that do not make 100 %', async () => {
      await expect(asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ subsidiaries: [{ subsidiaryId: s3.companyId }] }), a))).rejects.toThrow(
        NotFoundError,
      )
      await expect(asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ subsidiaries: [{ subsidiaryId: other.companyId }] }), a))).rejects.toThrow(
        /n’est pas une filiale de la holding/,
      )
      const custom = convention({
        allocationKey: 'CUSTOM',
        subsidiaries: [
          { subsidiaryId: s1.companyId, sharePercentBp: 6000 },
          { subsidiaryId: s2.companyId, sharePercentBp: 3000 },
        ],
      })
      await expect(asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, custom, a))).rejects.toThrow(/exactement 100/)
      await expect(asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ revenueAccountCode: '6226' }), a))).rejects.toThrow(ValidationError)
      await expect(asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ subsidiaries: [{ subsidiaryId: holding.companyId }] }), a))).rejects.toThrow(
        /sa propre filiale/,
      )
      expect(await prisma.managementFeeConvention.count()).toBe(0)
    })

    it('refuses VAT on the invoices of a holding under the VAT franchise (CGI art. 293 B)', async () => {
      await prisma.company.update({ where: { id: holding.companyId }, data: { isVatExempt: true } })
      await expect(asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))).rejects.toThrow(/franchise en base/)
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ vatRateBp: 0 }), a))
      expect(created.vatRateBp).toBe(0)
    })

    it('creates, reads, replaces and deletes a convention never invoiced', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      expect(created).toMatchObject({ label: 'Convention d’animation 2026', markupBp: 500, allocationKey: 'REVENUE', startDate: '2026-01-01', billingCount: 0 })
      const read = await asHolding(ACCOUNTANT, (a) => conventions.getConvention(holding.companyId, created.id, a))
      expect(read.subsidiaries.map((s) => [s.name, s.accessible])).toEqual([
        ['mf-filiale-1', true],
        ['mf-filiale-2', true],
      ])
      const updated = await asHolding(ACCOUNTANT, (a) =>
        conventions.updateConvention(holding.companyId, created.id, convention({ allocationKey: 'CUSTOM', subsidiaries: [{ subsidiaryId: s2.companyId, sharePercentBp: 10000, startDate: '2026-02-01' }] }), a),
      )
      expect(updated.subsidiaries).toEqual([{ subsidiaryId: s2.companyId, sharePercentBp: 10000, startDate: '2026-02-01', endDate: null }])
      // Another company's convention is a 404, even for a member of both
      await expect(withUserContext(ACCOUNTANT.id, () => conventions.loadConvention(other.companyId, created.id), { companyIds: [other.companyId] })).rejects.toThrow(NotFoundError)
      await asHolding(ACCOUNTANT, () => conventions.deleteConvention(holding.companyId, created.id))
      expect(await prisma.managementFeeConvention.count()).toBe(0)
    })

    it('names only the subsidiaries the user may still read', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      await prisma.member.deleteMany({ where: { userId: ACCOUNTANT.id, organization: { companyId: s2.companyId } } })
      const list = await asHolding(ACCOUNTANT, (a) => conventions.listConventions(holding.companyId, a))
      expect(list[0].subsidiaries.map((s) => [s.subsidiaryId, s.name, s.accessible])).toEqual([
        [s1.companyId, 'mf-filiale-1', true],
        [s2.companyId, null, false],
      ])
      // And computing the convention is refused: every company involved is checked
      await expect(asHolding(ACCOUNTANT, (a) => computing.computeConventionFees(holding.companyId, created.id, Q1, a))).rejects.toThrow(NotFoundError)
    })
  })

  describe('computation', () => {
    it('pools the validated charges of the period, without income tax and interest, adds the mark-up and splits by revenue', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      const preview = await asHolding(ACCOUNTANT, (a) => computing.computeConventionFees(holding.companyId, created.id, Q1, a))
      expect(preview.costPool?.accounts.map((x) => [x.code, x.cents])).toEqual([
        ['6064', 200_000],
        ['6226', 800_000],
      ])
      expect(preview.costPool?.excluded.map((x) => [x.code, x.cents])).toEqual([
        ['6616', 50_000],
        ['695', 300_000],
      ])
      expect(preview.result).toMatchObject({ costPoolCents: 1_000_000, baseCents: 1_000_000, markupCents: 50_000, totalExclTaxCents: 1_050_000, totalVatCents: 210_000 })
      expect(preview.result.parts.map((p) => [p.name, p.revenueCents, p.amountExclTaxCents, p.vatCents, p.amountInclTaxCents])).toEqual([
        ['mf-filiale-1', 3_000_000, 787_500, 157_500, 945_000],
        ['mf-filiale-2', 1_000_000, 262_500, 52_500, 315_000],
      ])
      expect(preview.warnings).toEqual([])
    })

    it('refuses a period outside the convention or longer than a year', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ startDate: '2026-02-01' }), a))
      await expect(asHolding(ACCOUNTANT, (a) => computing.computeConventionFees(holding.companyId, created.id, Q1, a))).rejects.toThrow(/sort de la durée/)
      await expect(
        asHolding(ACCOUNTANT, (a) => computing.computeConventionFees(holding.companyId, created.id, { periodStart: '2026-02-01', periodEnd: '2027-03-01' }, a)),
      ).rejects.toThrow(/une année au plus/)
    })
  })

  describe('invoices', () => {
    it('records draft sales invoices in the holding and proposes draft purchase invoices to the subsidiaries, posting nothing', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      const entriesBefore = await prisma.accountingEntry.count()
      const { billings } = await asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: true }, a))
      expect(billings.map((b) => [b.name, b.salesInvoice.number, b.amountExclTaxCents, b.vatCents, b.amountInclTaxCents, b.outcome])).toEqual([
        ['mf-filiale-1', 'FG-2026-001', 787_500, 157_500, 945_000, 'created'],
        ['mf-filiale-2', 'FG-2026-002', 262_500, 52_500, 315_000, 'created'],
      ])
      expect(await prisma.accountingEntry.count()).toBe(entriesBefore)

      const sale = await prisma.invoice.findUniqueOrThrow({ where: { id: billings[0].salesInvoice.id }, include: { lines: true, tiers: true } })
      expect(sale).toMatchObject({ companyId: holding.companyId, direction: 'SALE', entryId: null, issueDate: new Date('2026-03-31T00:00:00Z'), buyerSiren: '931000020' })
      expect(sale.totalExclTax.toString()).toBe('7875')
      expect(sale.totalVat.toString()).toBe('1575')
      expect(sale.lines[0]).toMatchObject({ accountCode: '706000', vatRateBp: 2000, nature: 'SERVICES' })
      expect(sale.tiers).toMatchObject({ kind: 'CUSTOMER', name: 'mf-filiale-1', siren: '931000020' })

      const purchase = await prisma.invoice.findUniqueOrThrow({ where: { id: billings[0].purchaseInvoiceId as string }, include: { lines: true, tiers: true } })
      expect(purchase).toMatchObject({ companyId: s1.companyId, direction: 'PURCHASE', number: 'FG-2026-001', entryId: null, sellerSiren: '931000012' })
      expect(purchase.totalInclTax.toString()).toBe('9450')
      expect(purchase.lines[0]).toMatchObject({ accountCode: '6226', vatRateBp: 2000 })
      expect(purchase.tiers).toMatchObject({ kind: 'SUPPLIER', name: 'mf-holding', siren: '931000012' })

      const views = await asHolding(ACCOUNTANT, (a) => billing.listBillings(holding.companyId, created.id, a))
      expect(views.map((v) => [v.subsidiaryName, v.salesInvoice, v.purchaseInvoice])).toEqual([
        ['mf-filiale-1', { id: billings[0].salesInvoice.id, number: 'FG-2026-001', posted: false }, { id: billings[0].purchaseInvoiceId, number: 'FG-2026-001', posted: false }],
        ['mf-filiale-2', { id: billings[1].salesInvoice.id, number: 'FG-2026-002', posted: false }, { id: billings[1].purchaseInvoiceId, number: 'FG-2026-002', posted: false }],
      ])

      // Invoiced: never invoiced twice, never deleted, no overlapping period
      await expect(asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: true }, a))).rejects.toThrow(
        /déjà facturée/,
      )
      await expect(
        asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { periodStart: '2026-03-01', periodEnd: '2026-04-30', purchaseDrafts: false }, a)),
      ).rejects.toThrow(/chevauche/)
      await expect(asHolding(ACCOUNTANT, () => conventions.deleteConvention(holding.companyId, created.id))).rejects.toThrow(ConflictError)
      expect(await prisma.invoice.count({ where: { companyId: holding.companyId, direction: 'SALE', number: { startsWith: 'FG-' } } })).toBe(2)
    })

    it('never recomputes an invoiced subsidiary and completes what a retry finds missing', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      await asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: false }, a))
      // The books change afterwards; the purchase drafts are then requested
      await entry(holding, '2026-03-30', '6064', '5000.00', 'charge')
      const { billings } = await asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: true }, a))
      expect(billings.map((b) => [b.outcome, b.amountExclTaxCents, b.purchaseInvoiceId !== null])).toEqual([
        ['existing', 787_500, true],
        ['existing', 262_500, true],
      ])
      expect(await prisma.invoice.count({ where: { direction: 'SALE', companyId: holding.companyId, number: { startsWith: 'FG-' } } })).toBe(2)
      expect((await prisma.invoice.findFirstOrThrow({ where: { companyId: s1.companyId, direction: 'PURCHASE' } })).totalExclTax.toString()).toBe('7875')
    })

    // KLEDG-SEC-010 (lib/__tests__/security/findings.ts): two generations at once
    // used to pass the overlap check and the billing lookup together, then both
    // recorded a sales invoice for the same subsidiary.
    it('[KLEDG-SEC-010] never invoices a subsidiary twice when generations run at once', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      const generate = (period: { periodStart: string; periodEnd: string }) =>
        asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...period, purchaseDrafts: false }, a))
      const runs = await Promise.allSettled([generate(Q1), generate(Q1), generate(Q1)])
      expect(runs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
      for (const run of runs) if (run.status === 'rejected') expect(run.reason).toBeInstanceOf(ConflictError)
      expect(await prisma.invoice.count({ where: { companyId: holding.companyId, direction: 'SALE', number: { startsWith: 'FG-' } } })).toBe(2)
      expect(await prisma.managementFeeBilling.count({ where: { salesInvoiceId: { not: null } } })).toBe(2)
    })

    it('[KLEDG-SEC-010] never proposes a purchase invoice twice to a subsidiary when generations run at once', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      const generate = () => asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: true }, a))
      const runs = await Promise.allSettled([generate(), generate(), generate(), generate(), generate(), generate()])
      for (const run of runs) if (run.status === 'rejected') expect(run.reason).toBeInstanceOf(ConflictError)
      for (const sub of [s1, s2]) {
        expect(await prisma.invoice.count({ where: { companyId: sub.companyId, direction: 'PURCHASE', number: { startsWith: 'FG-' } } })).toBe(1)
        expect(await prisma.tiers.count({ where: { companyId: sub.companyId, kind: 'SUPPLIER', siren: '931000012' } })).toBe(1)
      }
      const linked = await prisma.managementFeeBilling.findMany({ select: { purchaseInvoiceId: true } })
      expect(linked.every((b) => b.purchaseInvoiceId !== null)).toBe(true)
    })

    it('[KLEDG-SEC-010] never invoices overlapping periods when generations run at once', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention(), a))
      const generate = (period: { periodStart: string; periodEnd: string }) =>
        asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...period, purchaseDrafts: false }, a))
      const runs = await Promise.allSettled([generate(Q1), generate({ periodStart: '2026-02-01', periodEnd: '2026-04-30' })])
      expect(runs.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
      const refused = runs.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect(refused.reason).toBeInstanceOf(ConflictError)
      const periods = await prisma.managementFeeBilling.findMany({ select: { periodStart: true }, distinct: ['periodStart'] })
      expect(periods).toHaveLength(1)
      expect(await prisma.invoice.count({ where: { companyId: holding.companyId, direction: 'SALE', number: { startsWith: 'FG-' } } })).toBe(2)
    })

    it('checks the right to write in every subsidiary before writing anything', async () => {
      const created = await asHolding(MIXED, (a) =>
        conventions.createConvention(holding.companyId, convention({ allocationKey: 'EQUAL', pricing: 'FIXED', fixedAmountCents: 300_000 }), a),
      )
      // Read-only in the second subsidiary: no purchase draft can be proposed there
      const refused = asHolding(MIXED, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: true }, a))
      await expect(refused).rejects.toThrow(ForbiddenError)
      await expect(asHolding(MIXED, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: true }, a))).rejects.toThrow(
        /^mf-filiale-2 : Action non autorisée/,
      )
      expect(await prisma.managementFeeBilling.count()).toBe(0)
      expect(await prisma.invoice.count({ where: { number: { startsWith: 'FG-' } } })).toBe(0)

      // The holding's invoices alone: the subsidiary records the invoice it receives itself
      const { billings } = await asHolding(MIXED, (a) =>
        billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, issueDate: '2026-04-05', purchaseDrafts: false }, a),
      )
      expect(billings.map((b) => [b.amountExclTaxCents, b.salesInvoice.number, b.purchaseInvoiceId])).toEqual([
        [150_000, 'FG-2026-001', null],
        [150_000, 'FG-2026-002', null],
      ])
      expect(await prisma.invoice.count({ where: { companyId: { in: [s1.companyId, s2.companyId] } } })).toBe(0)
    })

    it('refuses to invoice a subsidiary the user cannot reach', async () => {
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ allocationKey: 'EQUAL' }), a))
      await prisma.member.deleteMany({ where: { userId: ACCOUNTANT.id, organization: { companyId: s1.companyId } } })
      await expect(asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: false }, a))).rejects.toThrow(
        accessMod.SUBSIDIARY_OUT_OF_REACH,
      )
      expect(await prisma.invoice.count({ where: { number: { startsWith: 'FG-' } } })).toBe(0)
    })

    it('continues the series of the year after invoices recorded by hand', async () => {
      await prisma.invoice.create({
        data: {
          companyId: holding.companyId,
          direction: 'SALE',
          tiersId: holding.customerId,
          number: 'FG-2026-007',
          issueDate: new Date('2026-02-01T00:00:00Z'),
          dueDate: new Date('2026-03-01T00:00:00Z'),
          totalExclTax: 10,
          totalVat: 2,
          totalInclTax: 12,
        },
      })
      const created = await asHolding(ACCOUNTANT, (a) => conventions.createConvention(holding.companyId, convention({ allocationKey: 'EQUAL', subsidiaries: [{ subsidiaryId: s1.companyId }] }), a))
      const { billings } = await asHolding(ACCOUNTANT, (a) => billing.generateManagementFeeInvoices(holding.companyId, created.id, { ...Q1, purchaseDrafts: false }, a))
      expect(billings[0].salesInvoice.number).toBe('FG-2026-008')
    })
  })
})
