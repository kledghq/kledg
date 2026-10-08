/**
 * Expense reports against PostgreSQL (skipped without the server): records
 * with amounts computed in cents, the claimant of a member created on their
 * first report, scoping by claimant, the workflow, posting for each kind of
 * claimant (421, 455, 467 or a chosen account) to the fiscal year containing
 * the end of the period and never another, the NDF or OD journal, the
 * reimbursement status derived from lettering, the annual distance of the
 * mileage scale across reports, keyword rules, and ids of another company
 * refused everywhere (IDOR).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('expense_reports')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'
import type { ExpenseActor } from '../actor'
import type { ExpenseLineBody } from '../manage-expense-reports.service'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let reports: typeof import('../manage-expense-reports.service')
let claimants: typeof import('../manage-expense-claimants.service')
let posting: typeof import('../post-expense-report.service')
let reimbursement: typeof import('../expense-reimbursement.service')
let rulesSvc: typeof import('../manage-category-rules.service')
let lettering: typeof import('@/lib/lettering/lettering.service')

const EXTRA_ACCOUNTS: Array<[string, string]> = [
  ['421000', 'Personnel, rémunérations dues'],
  ['455000', 'Associés, comptes courants'],
  ['4551', 'Associés, comptes courants, principal'],
  ['467000', 'Autres comptes débiteurs ou créditeurs'],
  ['6061', 'Fournitures non stockables'],
  ['6251', 'Voyages et déplacements'],
  ['6256', 'Missions'],
  ['6257', 'Réceptions'],
]

const EMPLOYEE: ExpenseActor = { userId: 'u-emp', canManage: false }
const OTHER: ExpenseActor = { userId: 'u-other', canManage: false }
const BOSS: ExpenseActor = { userId: 'u-boss', canManage: true }

const meal = (over: Partial<ExpenseLineBody> = {}): ExpenseLineBody => ({
  kind: 'EXPENSE',
  date: '2026-03-10',
  supplierName: 'Brasserie du Port',
  label: 'Déjeuner client Martin',
  category: 'RECEPTION',
  amountInclTaxCents: 11_000,
  vatRateBp: 1000,
  vatCents: null,
  receiptKind: 'INVOICE',
  electric: false,
  ...over,
})
const train = (over: Partial<ExpenseLineBody> = {}): ExpenseLineBody =>
  meal({ supplierName: 'SNCF', label: 'Paris, Lyon', category: 'TRANSPORT', amountInclTaxCents: 8_800, vatRateBp: 1000, ...over })
const trip = (over: Partial<ExpenseLineBody> = {}): ExpenseLineBody => ({
  kind: 'MILEAGE',
  date: '2026-03-12',
  label: 'Lyon, Grenoble, chantier',
  amountInclTaxCents: 0,
  vatRateBp: 0,
  receiptKind: 'NONE',
  vehicleType: 'CAR',
  fiscalPower: 5,
  electric: false,
  distanceKm: 100,
  ...over,
})

const period = { periodStart: '2026-03-01', periodEnd: '2026-03-31' }

async function entryLines(entryId: string) {
  const rows = await prisma.entryLine.findMany({
    where: { accountingEntryId: entryId },
    select: { debit: true, credit: true, auxiliaryAccountNumber: true, account: { select: { code: true } } },
    orderBy: { createdAt: 'asc' },
  })
  // Lines of one entry share their creation instant: compare them in a stable order
  return rows
    .map((r) => ({ code: r.account.code, debit: r.debit.toString(), credit: r.credit.toString(), aux: r.auxiliaryAccountNumber }))
    .sort((a, b) => a.code.localeCompare(b.code) || Number(a.debit) - Number(b.debit))
}

async function addMember(companyId: string, userId: string, role: string) {
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId, email: `${userId}@ndf.test`, name: userId === 'u-emp' ? 'Camille Martin' : userId }, update: {} })
  const organization = await prisma.organization.upsert({
    where: { companyId },
    create: { id: `org-${companyId}`, name: companyId, slug: `org-${companyId}`, createdAt: new Date(), companyId },
    update: {},
  })
  await prisma.member.create({ data: { id: `m-${userId}-${companyId}`, organizationId: organization.id, userId, role, createdAt: new Date() } })
}

async function seedCompany(siren: string, slug: string): Promise<Books> {
  const books = await seedBooks(prisma, svc, { siren, slug })
  for (const [code, label] of EXTRA_ACCOUNTS) {
    books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
  }
  return books
}

/** A validated bank entry debiting the claimant account, reconciled with a transaction; its claimant line id. */
async function bankReimbursement(books: Books, accountCode: string, date: string, amount: string, aux: string | null = null) {
  const created = await svc.createEntry({
    companyId: books.companyId,
    journalId: books.journals.BQ,
    date,
    description: 'Remboursement note de frais',
    status: 'validated',
    lines: [
      { accountId: books.accounts[accountCode], debit: amount, credit: '0', auxiliaryAccountNumber: aux },
      { accountId: books.accounts['512000'], debit: '0', credit: amount },
    ],
  })
  const bankAccount = await prisma.bankAccount.findFirstOrThrow({ where: { bankConnection: { companyId: books.companyId } }, select: { id: true } })
  await prisma.bankTransaction.create({
    data: { bankAccountId: bankAccount.id, externalTransactionId: `ndf-${created.id}`, amount, date: new Date(`${date}T00:00:00Z`), side: 'debit', reconciled: true, reconciledWith: created.id },
  })
  return (await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: created.id, accountId: books.accounts[accountCode] }, select: { id: true } })).id
}

async function validatedReport(books: Books, actor: ExpenseActor, lines: ExpenseLineBody[], input: Partial<typeof period> & { claimantId?: string } = {}) {
  const created = await reports.createExpenseReport(books.companyId, { ...period, ...input, lines }, actor)
  await reports.runExpenseWorkflow(books.companyId, created.id, { action: 'submit' }, actor)
  return reports.runExpenseWorkflow(books.companyId, created.id, { action: 'validate' }, BOSS)
}

describe.skipIf(!available)('expense reports (PostgreSQL)', () => {
  let books: Books

  beforeAll(async () => {
    await prepareTestDatabase('expense_reports')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    reports = await import('../manage-expense-reports.service')
    claimants = await import('../manage-expense-claimants.service')
    posting = await import('../post-expense-report.service')
    reimbursement = await import('../expense-reimbursement.service')
    rulesSvc = await import('../manage-category-rules.service')
    lettering = await import('@/lib/lettering/lettering.service')
  })
  beforeEach(async () => {
    await prepareTestDatabase('expense_reports')
    books = await seedCompany('900000201', 'ndf-alpha')
    await addMember(books.companyId, 'u-emp', 'viewer')
    await addMember(books.companyId, 'u-other', 'viewer')
    await addMember(books.companyId, 'u-boss', 'accountant')
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('records', () => {
    it('creates a member’s first report with their claimant, a number and the amounts computed in cents', async () => {
      const report = await reports.createExpenseReport(books.companyId, { ...period, label: 'Mars', lines: [meal(), train(), trip()] }, EMPLOYEE)
      expect(report).toMatchObject({
        number: 'NDF-0001',
        status: 'draft',
        own: true,
        claimant: { name: 'Camille Martin', kind: 'EMPLOYEE', auxiliaryAccountNumber: 'S00001' },
        totalInclTaxCents: 11_000 + 8_800 + 6_360,
        recoverableVatCents: 1_000,
        totalExpenseCents: 11_000 + 8_800 + 6_360 - 1_000,
      })
      expect(report.lines.map((l) => [l.category, l.recoverableVatCents, l.recovery])).toEqual([
        ['RECEPTION', 1_000, 'TVA récupérable'],
        ['TRANSPORT', 0, 'Transport de personnes : TVA non récupérable (CGI ann. II art. 206, IV, 2, 5°)'],
        ['MILEAGE', 0, 'Sans TVA'],
      ])
      expect(report.lines[2]).toMatchObject({ amountInclTaxCents: 6_360, scaleYear: 2026, powerClass: '5 CV', priorDistanceKm: 0 })
      const second = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, EMPLOYEE)
      expect(second.number).toBe('NDF-0002')
      expect(await prisma.expenseClaimant.count({ where: { companyId: books.companyId } })).toBe(1)
    })

    it('ignores totals a client sends and refuses lines out of the period, foreign VAT rates and inconsistent VAT, listing every problem', async () => {
      const attempt = reports.createExpenseReport(
        books.companyId,
        { ...period, lines: [meal({ date: '2026-04-02' }), meal({ vatRateBp: 1900 }), meal({ vatCents: 3_000 })] },
        EMPLOYEE,
      )
      await expect(attempt).rejects.toThrow(/Ligne 1 : la dépense du 02\/04\/2026 est hors de la période.*Ligne 2 : 19\W+n’est pas un taux de TVA français/)
      await expect(reports.createExpenseReport(books.companyId, { ...period, lines: [meal({ vatCents: 3_000 })] }, EMPLOYEE)).rejects.toThrow(/Ligne 1 : La TVA ne correspond pas au taux/)
      await expect(reports.createExpenseReport(books.companyId, { periodStart: '2026-03-31', periodEnd: '2026-03-01', lines: [] }, EMPLOYEE)).rejects.toThrow(/commence après sa fin/)
      expect(await prisma.expenseReport.count()).toBe(0)
    })

    it('applies the company’s keyword rules to a line sent without category', async () => {
      await rulesSvc.createCategoryRule(books.companyId, { keyword: 'sncf', category: 'TRANSPORT', accountCode: null, priority: 0 })
      await rulesSvc.createCategoryRule(books.companyId, { keyword: 'total', category: 'FUEL', accountCode: '6061', priority: 0 })
      const report = await reports.createExpenseReport(
        books.companyId,
        { ...period, lines: [meal({ category: undefined, supplierName: 'SNCF Voyageurs' }), meal({ category: undefined, supplierName: 'TotalEnergies', vatRateBp: 2000, amountInclTaxCents: 6_000 }), meal({ category: undefined, supplierName: 'Librairie' })] },
        EMPLOYEE,
      )
      expect(report.lines.map((l) => [l.category, l.accountCode, l.recoverableVatCents])).toEqual([
        ['TRANSPORT', null, 0],
        ['FUEL', '6061', 800],
        ['OTHER', null, 1_000],
      ])
    })

    it('counts the annual distance of the vehicle from the claimant’s other submitted reports', async () => {
      const first = await reports.createExpenseReport(books.companyId, { periodStart: '2026-01-01', periodEnd: '2026-02-28', lines: [trip({ date: '2026-02-10', distanceKm: 4_900 })] }, EMPLOYEE)
      // A draft does not count yet
      const draft = await reports.createExpenseReport(books.companyId, { ...period, lines: [trip({ distanceKm: 300 })] }, EMPLOYEE)
      expect(draft.lines[0]).toMatchObject({ priorDistanceKm: 0, amountInclTaxCents: 19_080 })
      await reports.runExpenseWorkflow(books.companyId, first.id, { action: 'submit' }, EMPLOYEE)
      const updated = await reports.updateExpenseReport(books.companyId, draft.id, { ...period, lines: [trip({ distanceKm: 300 })] }, EMPLOYEE)
      // scale(5200) - scale(4900) = 3251,40 - 3116,40 = 135,00 € (arrêté du 27 mars 2023, 5 CV)
      expect(updated.lines[0]).toMatchObject({ priorDistanceKm: 4_900, amountInclTaxCents: 13_500 })
      expect(updated.mileageBaselines).toEqual({ '2026:CAR:5:t': 4_900 })
    })
  })

  describe('who sees and changes what', () => {
    it('scopes a member who only submits to their own reports; a validator sees every report', async () => {
      const own = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, EMPLOYEE)
      await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, OTHER)
      expect((await reports.listExpenseReports(books.companyId, EMPLOYEE, { status: 'all', mine: false, limit: 50 })).items.map((r) => r.id)).toEqual([own.id])
      expect((await reports.listExpenseReports(books.companyId, BOSS, { status: 'all', mine: false, limit: 50 })).items).toHaveLength(2)
      expect((await reports.listExpenseReports(books.companyId, BOSS, { status: 'all', mine: true, limit: 50 })).items).toHaveLength(0)
      await expect(reports.getExpenseReport(books.companyId, own.id, OTHER)).rejects.toThrow('Note de frais introuvable')
      await expect(reports.updateExpenseReport(books.companyId, own.id, { ...period, lines: [] }, OTHER)).rejects.toThrow('Note de frais introuvable')
      await expect(reports.deleteExpenseReport(books.companyId, own.id, OTHER)).rejects.toThrow('Note de frais introuvable')
      const others = await prisma.expenseClaimant.findFirstOrThrow({ where: { userId: 'u-other' } })
      await expect(reports.createExpenseReport(books.companyId, { ...period, claimantId: others.id, lines: [meal()] }, EMPLOYEE)).rejects.toThrow('Bénéficiaire introuvable')
      expect((await claimants.listClaimants(books.companyId, EMPLOYEE)).claimants.map((c) => c.userId)).toEqual(['u-emp'])
    })

    it('runs the workflow: the author submits, a validator returns with a note, validates, reopens', async () => {
      const report = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, EMPLOYEE)
      const empty = await reports.createExpenseReport(books.companyId, { ...period, lines: [] }, EMPLOYEE)
      await expect(reports.runExpenseWorkflow(books.companyId, empty.id, { action: 'submit' }, EMPLOYEE)).rejects.toThrow(/au moins une dépense/)
      const submitted = await reports.runExpenseWorkflow(books.companyId, report.id, { action: 'submit' }, EMPLOYEE, { now: new Date('2026-04-01T08:00:00Z') })
      expect(submitted).toMatchObject({ status: 'submitted', submittedAt: '2026-04-01T08:00:00.000Z' })
      await expect(reports.updateExpenseReport(books.companyId, report.id, { ...period, lines: [meal()] }, EMPLOYEE)).rejects.toThrow(/est soumise/)
      await expect(reports.runExpenseWorkflow(books.companyId, report.id, { action: 'validate' }, EMPLOYEE)).rejects.toThrow(/Seul un administrateur ou un comptable/)
      await expect(reports.runExpenseWorkflow(books.companyId, report.id, { action: 'return' }, BOSS)).rejects.toThrow(/Expliquez/)
      const returned = await reports.runExpenseWorkflow(books.companyId, report.id, { action: 'return', note: 'Joindre la facture' }, BOSS)
      expect(returned).toMatchObject({ status: 'draft', returnNote: 'Joindre la facture' })
      await reports.runExpenseWorkflow(books.companyId, report.id, { action: 'submit' }, EMPLOYEE)
      const validated = await reports.runExpenseWorkflow(books.companyId, report.id, { action: 'validate' }, BOSS)
      expect(validated.status).toBe('validated')
      await expect(reports.updateExpenseReport(books.companyId, report.id, { ...period, lines: [meal()] }, BOSS)).rejects.toThrow(/est validée/)
      await expect(reports.deleteExpenseReport(books.companyId, report.id, EMPLOYEE)).rejects.toThrow(/seul un valideur/)
      expect((await reports.runExpenseWorkflow(books.companyId, report.id, { action: 'reopen' }, BOSS)).status).toBe('draft')
    })

    it('lets the author validate their own report only as the company’s sole validator, and records it', async () => {
      const own = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, BOSS)
      await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'submit' }, BOSS)
      expect((await reports.getExpenseReport(books.companyId, own.id, BOSS)).ownValidation).toBe('sole-validator')
      const validated = await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'validate' }, BOSS)
      expect(validated).toMatchObject({ status: 'validated', selfValidated: true, ownValidation: null })
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'VALIDATE_EXPENSE_REPORT', companyId: books.companyId }, orderBy: { createdAt: 'desc' } })
      expect(audit.metadata).toMatchObject({ reportId: own.id, selfValidated: true })
      expect(audit.message).toMatch(/by its own author/)
      // Reopened, the mark goes with the validation.
      expect((await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'reopen' }, BOSS)).selfValidated).toBe(false)
    })

    it('refuses the author’s own validation while another member may validate; that member validates it', async () => {
      await addMember(books.companyId, 'u-admin', 'companyAdmin')
      const ADMIN: ExpenseActor = { userId: 'u-admin', canManage: true }
      const own = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, BOSS)
      await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'submit' }, BOSS)
      expect((await reports.getExpenseReport(books.companyId, own.id, BOSS)).ownValidation).toBe('refused')
      await expect(reports.runExpenseWorkflow(books.companyId, own.id, { action: 'validate' }, BOSS)).rejects.toThrow(
        'Vous ne pouvez pas valider votre propre note de frais\u00a0: un autre membre de la société a le droit de la valider',
      )
      expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: own.id } })).status).toBe('SUBMITTED')
      // Not the other validator's own report: no mark.
      expect((await reports.getExpenseReport(books.companyId, own.id, ADMIN)).ownValidation).toBeNull()
      const validated = await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'validate' }, ADMIN)
      expect(validated).toMatchObject({ status: 'validated', selfValidated: false })
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'VALIDATE_EXPENSE_REPORT', companyId: books.companyId }, orderBy: { createdAt: 'desc' } })
      expect(audit.metadata).toMatchObject({ reportId: own.id, selfValidated: false })
    })

    it('does not count a banned member nor a member without the validation right as another validator', async () => {
      await addMember(books.companyId, 'u-banned', 'companyAdmin')
      await prisma.user.update({ where: { id: 'u-banned' }, data: { banned: true } })
      const own = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, BOSS)
      await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'submit' }, BOSS)
      expect((await reports.runExpenseWorkflow(books.companyId, own.id, { action: 'validate' }, BOSS)).selfValidated).toBe(true)
    })

    it('refuses to validate a line of category "Autre dépense" without an account', async () => {
      const report = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal({ category: 'OTHER' })] }, EMPLOYEE)
      await reports.runExpenseWorkflow(books.companyId, report.id, { action: 'submit' }, EMPLOYEE)
      await expect(reports.runExpenseWorkflow(books.companyId, report.id, { action: 'validate' }, BOSS)).rejects.toThrow(/compte de charge des lignes 1/)
    })
  })

  describe('posting', () => {
    it('posts an employee’s report to 421 with the expense accounts HT, the recoverable VAT on 44566 and the claimant line TTC, in OD', async () => {
      const report = await validatedReport(books, EMPLOYEE, [meal(), train(), meal({ category: 'SUPPLIES', accountCode: '6064', amountInclTaxCents: 2_400, vatRateBp: 2000, receiptKind: 'RECEIPT' }), trip()])
      const posted = await posting.postExpenseReport(books.companyId, report.id)
      expect(posted).toMatchObject({ journal: 'OD', fiscalYear: 2026 })
      const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: posted.entryId }, select: { date: true, status: true, journalId: true, reference: true, fiscalYearId: true } })
      expect(entry).toMatchObject({ date: new Date('2026-03-31T00:00:00Z'), status: 'draft', journalId: books.journals.OD, reference: 'NDF-0001', fiscalYearId: books.fiscalYearId })
      expect(await entryLines(posted.entryId)).toEqual([
        { code: '421000', debit: '0', credit: '285.6', aux: 'S00001' },
        { code: '445660', debit: '4', credit: '0', aux: null },
        { code: '445660', debit: '10', credit: '0', aux: null },
        { code: '6064', debit: '20', credit: '0', aux: null },
        { code: '6251', debit: '63.6', credit: '0', aux: null },
        { code: '6251', debit: '88', credit: '0', aux: null },
        { code: '6257', debit: '100', credit: '0', aux: null },
      ])
      expect((await reports.getExpenseReport(books.companyId, report.id, EMPLOYEE)).status).toBe('posted')
      await expect(posting.postExpenseReport(books.companyId, report.id)).rejects.toThrow(/déjà comptabilisée/)
    })

    it('posts an associé’s report to 455, a dirigeant’s to 467, and a claimant’s own account when set; uses the NDF journal when it exists', async () => {
      const ndf = await prisma.journal.create({ data: { companyId: books.companyId, code: 'NDF', label: 'Notes de frais' } })
      const associe = await claimants.createClaimant(books.companyId, { kind: 'ASSOCIE', name: 'Alex Durand' })
      const dirigeant = await claimants.createClaimant(books.companyId, { kind: 'DIRIGEANT', name: 'Dominique Petit' })
      const chosen = await claimants.createClaimant(books.companyId, { kind: 'ASSOCIE', name: 'Sam Leroy', accountCode: '4551' })
      expect([associe.auxiliaryAccountNumber, dirigeant.auxiliaryAccountNumber, chosen.auxiliaryAccountNumber]).toEqual(['A00001', 'D00001', 'A00002'])
      const expected = [
        [associe.id, '455000', 'A00001'],
        [dirigeant.id, '467000', 'D00001'],
        [chosen.id, '4551', 'A00002'],
      ] as const
      for (const [claimantId, code, aux] of expected) {
        const report = await validatedReport(books, BOSS, [meal()], { claimantId })
        const posted = await posting.postExpenseReport(books.companyId, report.id)
        expect(posted.journal).toBe('NDF')
        const lines = await entryLines(posted.entryId)
        expect(lines.find((l) => l.credit !== '0')).toEqual({ code, debit: '0', credit: '110', aux })
        expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: posted.entryId } })).journalId).toBe(ndf.id)
      }
      await expect(claimants.createClaimant(books.companyId, { kind: 'EMPLOYEE', name: 'X', accountCode: '512000' })).rejects.toThrow()
    })

    it('posts only to the fiscal year containing the end of the period: refuses a closed year, a missing year and a line of another year', async () => {
      const closed = await validatedReport(books, EMPLOYEE, [meal({ date: '2025-12-10' })], { periodStart: '2025-12-01', periodEnd: '2025-12-31' })
      await expect(posting.postExpenseReport(books.companyId, closed.id)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/2025 est clôturé/) })
      const across = await validatedReport(books, EMPLOYEE, [meal({ date: '2025-12-29' }), meal({ date: '2026-01-03' })], { periodStart: '2025-12-28', periodEnd: '2026-01-05' })
      await expect(posting.postExpenseReport(books.companyId, across.id)).rejects.toThrow(/Ligne 1 : la dépense du 29\/12\/2025 relève d’un autre exercice que 2026/)
      const future = await validatedReport(books, EMPLOYEE, [meal({ date: '2027-01-10' })], { periodStart: '2027-01-01', periodEnd: '2027-01-31' })
      await expect(posting.postExpenseReport(books.companyId, future.id)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Aucun exercice ne contient le 31\/01\/2027/) })
      expect(await prisma.accountingEntry.count({ where: { reference: { startsWith: 'NDF-' } } })).toBe(0)
    })

    it('refuses to post a report that is not validated, and unposts a draft entry only', async () => {
      const draft = await reports.createExpenseReport(books.companyId, { ...period, lines: [meal()] }, EMPLOYEE)
      await expect(posting.postExpenseReport(books.companyId, draft.id)).rejects.toThrow(/doit être validée/)
      const report = await validatedReport(books, EMPLOYEE, [meal()])
      const posted = await posting.postExpenseReport(books.companyId, report.id)
      await posting.unpostExpenseReport(books.companyId, report.id)
      expect(await prisma.accountingEntry.findUnique({ where: { id: posted.entryId } })).toBeNull()
      expect((await reports.getExpenseReport(books.companyId, report.id, BOSS)).status).toBe('validated')
      const again = await posting.postExpenseReport(books.companyId, report.id)
      await svc.validateEntries(books.companyId, [again.entryId])
      await expect(posting.unpostExpenseReport(books.companyId, report.id)).rejects.toThrow(/contre-passez-la/)
    })
  })

  describe('reimbursement', () => {
    it('becomes remboursée when the claimant line is lettered with the reconciled transfer, and posted again once unlettered', async () => {
      const report = await validatedReport(books, EMPLOYEE, [meal(), trip()])
      const posted = await posting.postExpenseReport(books.companyId, report.id)
      const payment = await bankReimbursement(books, '421000', '2026-04-05', '173.6')
      await bankReimbursement(books, '421000', '2026-04-06', '50')
      // Draft entry: lettering needs validated entries
      await expect(reimbursement.reimburseExpenseReport(books.companyId, report.id, [payment])).rejects.toThrow(/Validez l’écriture de la note de frais/)
      await svc.validateEntries(books.companyId, [posted.entryId])

      const { candidates, amountCents } = await reimbursement.listReimbursementCandidates(books.companyId, report.id)
      expect(amountCents).toBe(17_360)
      expect(candidates.map((c) => [c.amountCents, c.exact])).toEqual([
        [17_360, true],
        [5_000, false],
      ])
      const wrong = candidates.find((c) => !c.exact)!.entryLineId
      await expect(reimbursement.reimburseExpenseReport(books.companyId, report.id, [wrong])).rejects.toThrow(/font 50,00 €, la note de frais 173,60 €/)

      const group = await reimbursement.reimburseExpenseReport(books.companyId, report.id, [payment], { now: new Date('2026-04-07T09:00:00Z') })
      expect(group).toMatchObject({ code: 'AA', letteringDate: '2026-04-07', amountCents: 17_360 })
      const detail = await reports.getExpenseReport(books.companyId, report.id, EMPLOYEE)
      expect(detail).toMatchObject({ status: 'reimbursed', letteringCode: 'AA' })
      expect((await reports.listExpenseReports(books.companyId, BOSS, { status: 'reimbursed', mine: false, limit: 50 })).items.map((r) => r.id)).toEqual([report.id])
      expect((await reports.listExpenseReports(books.companyId, BOSS, { status: 'posted', mine: false, limit: 50 })).items).toEqual([])
      await expect(reimbursement.reimburseExpenseReport(books.companyId, report.id, [payment])).rejects.toThrow(/déjà remboursée/)

      // Unlettering in Lettrage brings the report back to comptabilisée
      await lettering.unletterCode(books.companyId, { accountId: books.accounts['421000'], code: 'AA' })
      expect((await reports.getExpenseReport(books.companyId, report.id, EMPLOYEE)).status).toBe('posted')
    })

    it('never takes a bank line that is not reconciled, nor one of another claimant', async () => {
      const report = await validatedReport(books, EMPLOYEE, [meal()])
      const posted = await posting.postExpenseReport(books.companyId, report.id)
      await svc.validateEntries(books.companyId, [posted.entryId])
      const otherClaimant = await bankReimbursement(books, '421000', '2026-04-05', '110', 'S09999')
      const manual = await svc.createEntry({
        companyId: books.companyId,
        journalId: books.journals.OD,
        date: '2026-04-05',
        description: 'Saisie manuelle',
        status: 'validated',
        lines: [
          { accountId: books.accounts['421000'], debit: '110', credit: '0' },
          { accountId: books.accounts['512000'], debit: '0', credit: '110' },
        ],
      })
      const manualLine = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: manual.id, accountId: books.accounts['421000'] } })
      expect((await reimbursement.listReimbursementCandidates(books.companyId, report.id)).candidates).toEqual([])
      for (const line of [otherClaimant, manualLine.id]) {
        await expect(reimbursement.reimburseExpenseReport(books.companyId, report.id, [line])).rejects.toThrow(/rapprochez d’abord/)
      }
    })
  })

  describe('another company (IDOR)', () => {
    it('never reaches a report, claimant, receipt or bank line of another company', async () => {
      const other = await seedCompany('900000202', 'ndf-beta')
      await addMember(other.companyId, 'u-emp', 'viewer')
      const foreignReport = await validatedReport(other, EMPLOYEE, [meal()])
      const foreignClaimant = await prisma.expenseClaimant.findFirstOrThrow({ where: { companyId: other.companyId } })
      const foreignAttachment = await prisma.attachment.create({ data: { companyId: other.companyId, fileName: 'ticket.pdf' } })

      await expect(reports.getExpenseReport(books.companyId, foreignReport.id, BOSS)).rejects.toThrow('Note de frais introuvable')
      await expect(reports.updateExpenseReport(books.companyId, foreignReport.id, { ...period, lines: [] }, BOSS)).rejects.toThrow('Note de frais introuvable')
      await expect(reports.runExpenseWorkflow(books.companyId, foreignReport.id, { action: 'reopen' }, BOSS)).rejects.toThrow('Note de frais introuvable')
      await expect(posting.postExpenseReport(books.companyId, foreignReport.id)).rejects.toThrow('Note de frais introuvable')
      await expect(reimbursement.listReimbursementCandidates(books.companyId, foreignReport.id)).rejects.toThrow('Note de frais introuvable')
      await expect(reports.createExpenseReport(books.companyId, { ...period, claimantId: foreignClaimant.id, lines: [meal()] }, BOSS)).rejects.toThrow('Bénéficiaire introuvable')
      await expect(claimants.updateClaimant(books.companyId, foreignClaimant.id, { name: 'Pirate' })).rejects.toThrow('Bénéficiaire introuvable')
      await expect(reports.createExpenseReport(books.companyId, { ...period, lines: [meal({ receiptAttachmentId: foreignAttachment.id })] }, EMPLOYEE)).rejects.toThrow(/justificatif introuvable dans cette société/)
      const otherPerson = await prisma.person.create({ data: { firstName: 'Lou', name: 'Bernard', companyId: other.companyId } })
      await expect(claimants.createClaimant(books.companyId, { kind: 'EMPLOYEE', name: 'Lou', personId: otherPerson.id })).rejects.toThrow(/Personne introuvable/)
      await expect(claimants.createClaimant(books.companyId, { kind: 'EMPLOYEE', name: 'Nobody', userId: 'u-stranger' })).rejects.toThrow(/n’appartient pas à la société/)

      // A bank line of company B cannot reimburse a report of company A
      const own = await validatedReport(books, EMPLOYEE, [meal()])
      const posted = await posting.postExpenseReport(books.companyId, own.id)
      await svc.validateEntries(books.companyId, [posted.entryId])
      const foreignPayment = await bankReimbursement(other, '421000', '2026-04-05', '110')
      await expect(reimbursement.reimburseExpenseReport(books.companyId, own.id, [foreignPayment])).rejects.toThrow(/rapprochez d’abord/)
      expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: foreignReport.id } })).status).toBe('VALIDATED')
    })
  })
})
