/**
 * Budgets against PostgreSQL (skipped without the server): one budget per
 * fiscal year of the company, lines on prefixes with amounts per month and
 * recurring items, the budget of a closed year frozen, ids of another
 * company refused everywhere (IDOR), the composite foreign key that keeps a
 * budget in its fiscal year's company, and the comparison with the books:
 * validated entries only, closing entries excluded, months from the entry
 * dates, totals equal to the compte de résultat's charges and produits.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('budgets')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import { withSystemContext } from '@/lib/rls/context'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let budgets: typeof import('../manage-budgets.service')
let reports: typeof import('../get-budget-report.service')
let aggregate: typeof import('@/lib/reports/ledger/aggregate')
let statements: typeof import('@/lib/reports/statements/load')
let summary: typeof import('@/lib/dashboard/ledger-summary')

describe.skipIf(!available)('budgets (PostgreSQL)', () => {
  let books: Books
  let other: Books

  beforeAll(async () => {
    await prepareTestDatabase('budgets')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    budgets = await import('../manage-budgets.service')
    reports = await import('../get-budget-report.service')
    aggregate = await import('@/lib/reports/ledger/aggregate')
    statements = await import('@/lib/reports/statements/load')
    summary = await import('@/lib/dashboard/ledger-summary')
  })

  beforeEach(async () => {
    await prepareTestDatabase('budgets')
    books = await seedBooks(prisma, svc, { siren: '940000101', slug: 'budget-a' })
    other = await seedBooks(prisma, svc, { siren: '940000102', slug: 'budget-b' })
    for (const [code, label] of [['622600', 'Honoraires'], ['626000', 'Frais postaux et de télécommunications'], ['613200', 'Locations immobilières'], ['120000', "Résultat de l'exercice (bénéfice)"]]) {
      books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
    }
    await prisma.journal.create({ data: { companyId: books.companyId, code: 'CL', label: 'Clôture' } })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  /** A validated (or draft) entry of company A: debit one account, credit another. */
  async function entry(date: string, debit: string, credit: string, amount: string, options: { status?: 'draft' | 'validated'; journal?: string; reference?: string } = {}) {
    const journalId = options.journal === 'CL' ? (await prisma.journal.findFirstOrThrow({ where: { companyId: books.companyId, code: 'CL' } })).id : books.journals.OD
    await svc.createEntry({
      companyId: books.companyId,
      journalId,
      date,
      description: `Écriture ${date}`,
      reference: options.reference ?? null,
      status: options.status ?? 'validated',
      lines: [
        { accountId: books.accounts[debit], debit: amount, credit: '0' },
        { accountId: books.accounts[credit], debit: '0', credit: amount },
      ],
    })
  }

  describe('budgets and lines', () => {
    it('creates one budget per fiscal year, with the main posts on request', async () => {
      const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'posts' })
      expect(budget).toMatchObject({ fiscalYear: { year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false }, editable: true, lineCount: 7, chargesCents: 0 })
      expect(budget.months).toHaveLength(12)
      expect(budget.lines.map((l) => [l.accountPrefix, l.label, l.side])).toEqual([
        ['60', 'Achats', 'charges'],
        ['61', 'Services extérieurs', 'charges'],
        ['62', 'Autres services extérieurs', 'charges'],
        ['63', 'Impôts, taxes et versements assimilés', 'charges'],
        ['64', 'Charges de personnel', 'charges'],
        ['65', 'Autres charges de gestion courante', 'charges'],
        ['70', 'Ventes', 'produits'],
      ])
      await expect(budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'empty' })).rejects.toMatchObject({
        statusCode: 409,
        message: "L'exercice 2026 a déjà un budget.",
      })
      // Another company's fiscal year is unknown here
      await expect(budgets.createBudget(books.companyId, { fiscalYearId: other.fiscalYearId, template: 'empty' })).rejects.toMatchObject({ statusCode: 404 })
    })

    it('freezes the budget of a closed fiscal year', async () => {
      await expect(budgets.createBudget(books.companyId, { fiscalYearId: books.closedFiscalYearId, template: 'empty' })).rejects.toMatchObject({
        statusCode: 409,
        message: "L'exercice 2025 est clôturé : son budget ne se modifie plus.",
      })
      // A budget recorded before the closing: readable, never changed
      const frozen = await withSystemContext('test', () => prisma.budget.create({ data: { companyId: books.companyId, fiscalYearId: books.closedFiscalYearId } }))
      expect((await budgets.getBudget(books.companyId, frozen.id)).editable).toBe(false)
      await expect(budgets.createBudgetLine(books.companyId, frozen.id, { accountPrefix: '706' })).rejects.toMatchObject({ statusCode: 409 })
      await expect(budgets.deleteBudget(books.companyId, frozen.id)).rejects.toMatchObject({ statusCode: 409 })
    })

    it('stores amounts per month and recurring items, labels from the chart or the PCG', async () => {
      const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'empty' })
      const fees = await budgets.createBudgetLine(books.companyId, budget.id, {
        accountPrefix: '622600',
        amounts: [
          { month: '2026-03', amountCents: 150_000 },
          { month: '2026-09', amountCents: 0 },
        ],
        recurringItems: [{ label: 'Expert-comptable', amountCents: 30_000, frequency: 'QUARTERLY', startMonth: '2025-12', endMonth: null }],
      })
      // The company's own account label; a quarterly item anchored in December 2025 falls due in March, June, September, December
      expect(fees).toMatchObject({ label: 'Honoraires', side: 'charges', amounts: [{ month: '2026-03', amountCents: 150_000 }], annualCents: 150_000 + 4 * 30_000 })
      expect(fees.plannedMonths[2]).toBe(180_000)
      expect(fees.plannedMonths[1]).toBe(0)

      const rent = await budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '6132', label: null })
      expect(rent.label).toBe('Locations immobilières')

      await expect(budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '622600' })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Le budget a déjà une ligne sur le compte 622600 : modifiez-la.',
      })
      await expect(budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '706', amounts: [{ month: '2027-01', amountCents: 1 }] })).rejects.toMatchObject({
        statusCode: 400,
        message: "Le mois 2027-01 n'est pas dans l'exercice 2026.",
      })
      await expect(
        budgets.createBudgetLine(books.companyId, budget.id, {
          accountPrefix: '706',
          amounts: [
            { month: '2026-01', amountCents: 1 },
            { month: '2026-01', amountCents: 2 },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: 'Le mois 2026-01 est saisi deux fois.' })
      await expect(
        budgets.createBudgetLine(books.companyId, budget.id, {
          accountPrefix: '706',
          recurringItems: [{ label: 'Contrat terminé', amountCents: 5_000, frequency: 'MONTHLY', startMonth: '2025-01', endMonth: '2025-12' }],
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('ne tombe dans aucun mois') })

      const updated = await budgets.updateBudgetLine(books.companyId, fees.id, {
        amounts: [{ month: '2026-01', amountCents: 10_000 }],
        recurringItems: [],
        label: 'Honoraires juridiques',
      })
      expect(updated).toMatchObject({ label: 'Honoraires juridiques', annualCents: 10_000, recurringItems: [], amounts: [{ month: '2026-01', amountCents: 10_000 }] })
      // Amounts not sent are kept, a cleared label comes back from the chart
      const relabeled = await budgets.updateBudgetLine(books.companyId, fees.id, { label: null })
      expect(relabeled).toMatchObject({ label: 'Honoraires', annualCents: 10_000 })
      await expect(budgets.updateBudgetLine(books.companyId, fees.id, { accountPrefix: '6132' })).rejects.toMatchObject({ statusCode: 409 })

      const detail = await budgets.getBudget(books.companyId, budget.id)
      expect(detail).toMatchObject({ lineCount: 2, chargesCents: 10_000, produitsCents: 0, resultatCents: -10_000 })
      expect((await budgets.listBudgets(books.companyId)).items).toEqual([expect.objectContaining({ id: budget.id, lineCount: 2, chargesCents: 10_000 })])

      await budgets.deleteBudgetLine(books.companyId, rent.id)
      expect(await prisma.budgetLine.count({ where: { budgetId: budget.id } })).toBe(1)
      await budgets.deleteBudget(books.companyId, budget.id)
      expect(await withSystemContext('test', () => prisma.budgetLineAmount.count())).toBe(0)
    })

    it('refuses every id of another company (IDOR)', async () => {
      const mine = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'empty' })
      const theirs = await budgets.createBudget(other.companyId, { fiscalYearId: other.fiscalYearId, template: 'empty' })
      const theirLine = await budgets.createBudgetLine(other.companyId, theirs.id, { accountPrefix: '706', amounts: [{ month: '2026-01', amountCents: 100 }] })
      await expect(budgets.getBudget(books.companyId, theirs.id)).rejects.toMatchObject({ statusCode: 404, message: 'Budget introuvable' })
      await expect(reports.getBudgetReport(books.companyId, theirs.id)).rejects.toMatchObject({ statusCode: 404 })
      await expect(budgets.createBudgetLine(books.companyId, theirs.id, { accountPrefix: '706' })).rejects.toMatchObject({ statusCode: 404 })
      await expect(budgets.updateBudgetLine(books.companyId, theirLine.id, { label: 'Pris' })).rejects.toMatchObject({ statusCode: 404 })
      await expect(budgets.deleteBudgetLine(books.companyId, theirLine.id)).rejects.toMatchObject({ statusCode: 404 })
      await expect(budgets.deleteBudget(books.companyId, theirs.id)).rejects.toMatchObject({ statusCode: 404 })
      expect((await budgets.listBudgets(books.companyId)).items.map((b) => b.id)).toEqual([mine.id])
      expect((await budgets.getBudget(other.companyId, theirs.id)).lines[0].label).toBe('Prestations de services')
    })

    it('keeps a budget in the company of its fiscal year in the database itself', async () => {
      const attempt = withSystemContext('test', () => prisma.budget.create({ data: { companyId: books.companyId, fiscalYearId: other.fiscalYearId } }))
      await expect(attempt).rejects.toThrow()
      const badPrefix = withSystemContext('test', async () => {
        const budget = await prisma.budget.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId } })
        return prisma.budgetLine.create({ data: { budgetId: budget.id, accountPrefix: '512', label: 'Banque' } })
      })
      await expect(badPrefix).rejects.toThrow()
    })
  })

  describe('budget against the books', () => {
    it('compares per line and per month with validated entries, closing entries excluded', async () => {
      // Charges
      await entry('2026-01-15', '622600', '401000', '1200.00')
      await entry('2026-02-10', '626000', '401000', '80.40')
      await entry('2026-02-20', '6064', '401000', '45.50')
      await entry('2026-03-05', '622600', '401000', '999.00', { status: 'draft' })
      // Produits, and a credit note on sales in March
      await entry('2026-01-31', '411000', '706000', '5000.00')
      await entry('2026-02-28', '411000', '706000', '6000.00')
      await entry('2026-03-31', '706000', '411000', '500.00')
      // Last day of the year, then its closing entry zeroing 706 (journal CL)
      await entry('2026-12-31', '411000', '706000', '1000.00')
      await entry('2026-12-31', '706000', '120000', '11500.00', { journal: 'CL', reference: 'CL-2026' })

      const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'empty' })
      await budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '62', recurringItems: [{ label: 'Divers', amountCents: 10_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null }] })
      await budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '6226', amounts: [{ month: '2026-01', amountCents: 100_000 }] })
      await budgets.createBudgetLine(books.companyId, budget.id, {
        accountPrefix: '706',
        recurringItems: [{ label: 'Contrat de maintenance', amountCents: 500_000, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null }],
      })

      const report = await reports.getBudgetReport(books.companyId, budget.id)
      const [l62, l6226] = report.charges.lines
      expect(l6226).toMatchObject({ accountPrefix: '6226', budgetCents: 100_000, actualCents: 120_000, varianceCents: 20_000, variancePercent: 20, favorable: false })
      expect(l6226.months[0]).toEqual({ month: '2026-01', budgetCents: 100_000, actualCents: 120_000, varianceCents: 20_000 })
      // The draft of March does not count
      expect(l6226.months[2].actualCents).toBe(0)
      expect(l62).toMatchObject({ budgetCents: 120_000, actualCents: 8_040, accounts: [{ code: '626000', label: 'Frais postaux et de télécommunications', actualCents: 8_040 }] })
      expect(report.charges.unbudgeted.map((r) => [r.accountPrefix, r.actualCents])).toEqual([['6064', 4_550]])

      const [l706] = report.produits.lines
      expect(l706).toMatchObject({ budgetCents: 6_000_000, actualCents: 1_150_000, favorable: false })
      expect(l706.months.map((m) => m.actualCents)).toEqual([500_000, 600_000, -50_000, 0, 0, 0, 0, 0, 0, 0, 0, 100_000])

      // Totals are the compte de résultat's (statements exclude the closing entry too)
      const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: books.fiscalYearId } })
      const ledger = summary.summarizeLedger(await statements.loadStatementAccounts(books.companyId, fy))
      expect(report.charges.total.actualCents).toBe(ledger.chargesCents)
      expect(report.produits.total.actualCents).toBe(ledger.produitsCents)
      expect(report.resultat.actualCents).toBe(ledger.resultatCents)
      expect(report.resultat).toMatchObject({ budgetCents: 6_000_000 - 220_000, actualCents: 1_150_000 - 132_590 })

      // Year to date: the budget of the same months
      const toFebruary = await reports.getBudgetReport(books.companyId, budget.id, { throughMonth: '2026-02' })
      expect(toFebruary.produits.lines[0]).toMatchObject({ budgetCents: 1_000_000, actualCents: 1_100_000, annualBudgetCents: 6_000_000, favorable: true })
      await expect(reports.getBudgetReport(books.companyId, budget.id, { throughMonth: '2027-01' })).rejects.toMatchObject({
        statusCode: 400,
        message: "Le mois 2027-01 n'est pas dans l'exercice 2026.",
      })

      // By fiscal year (MCP), 404 without a budget
      expect((await reports.getBudgetReportOfFiscalYear(books.companyId, books.fiscalYearId)).budgetId).toBe(budget.id)
      await expect(reports.getBudgetReportOfFiscalYear(books.companyId, books.closedFiscalYearId)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('splits the ledger totals by month without changing them', async () => {
      await entry('2026-01-31', '411000', '706000', '100.01')
      await entry('2026-06-30', '411000', '706000', '200.02')
      await entry('2026-12-31', '6064', '512000', '0.07')
      const params = { companyId: books.companyId, fiscalYearId: books.fiscalYearId, excludeClosingEntries: true }
      const monthly = await aggregate.sumAccountTotalsByMonth(params)
      const yearly = await aggregate.sumAccountTotals(params)
      expect(monthly.filter((r) => r.accountId === books.accounts['706000']).map((r) => [r.month, r.creditCents]).sort()).toEqual([
        ['2026-01', 10_001],
        ['2026-06', 20_002],
      ])
      for (const row of yearly) {
        const months = monthly.filter((r) => r.accountId === row.accountId)
        expect(months.reduce((s, r) => s + r.debitCents, 0)).toBe(row.debitCents)
        expect(months.reduce((s, r) => s + r.creditCents, 0)).toBe(row.creditCents)
      }
      // Company B's books are never read
      expect(await aggregate.sumAccountTotalsByMonth({ ...params, companyId: other.companyId })).toEqual([])
    })
  })
})
