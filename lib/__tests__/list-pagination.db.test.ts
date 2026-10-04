/**
 * Entries and bank transactions lists against PostgreSQL (skipped without the
 * server): the lists load lines, accounts and attachments in separate queries
 * (no bind parameter limit on large years) and can be paged with a cursor.
 * - every page together gives the full list, in the same order, nothing twice;
 * - lines carry their account, transactions their attachments;
 * - a cursor from another company is ignored (the first page is returned);
 * - categoriesOnly gives the distinct provider categories and no transactions;
 * - the filters of the entries and transactions pages run in the database and
 *   select exactly what the pages used to filter in the browser.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('list_pagination')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { FIRST_YEAR, MAIN_COMPANY_ID, PROFILES, seedDataset } from '@/scripts/bench/dataset'

const available = await testDatabaseAvailable()
const company = MAIN_COMPANY_ID
const openYear = FIRST_YEAR + PROFILES.tiny.main.years - 1

let prisma: typeof import('@/lib/prisma').prisma
let entries: typeof import('@/lib/accounting/services/list-entries.service')
let transactions: typeof import('@/lib/transactions/list-transactions.service')

describe.skipIf(!available)('paged lists', () => {
  beforeAll(async () => {
    const url = await prepareTestDatabase('list_pagination')
    await seedDataset(url, PROFILES.tiny)
    ;({ prisma } = await import('@/lib/prisma'))
    entries = await import('@/lib/accounting/services/list-entries.service')
    transactions = await import('@/lib/transactions/list-transactions.service')
  }, 120_000)

  afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  it('entries: pages add up to the full list, with lines and accounts', async () => {
    const fiscalYearId = `${company}_fy${openYear}`
    const full = await entries.listEntries({ companyId: company, fiscalYearId })
    expect(full.entries.length).toBe(await prisma.accountingEntry.count({ where: { companyId: company, fiscalYearId } }))
    expect(full.nextCursor).toBeNull()
    for (const entry of full.entries) {
      expect(entry.lines.length).toBeGreaterThanOrEqual(2)
      for (const line of entry.lines) expect(line.account.id).toBe(line.accountId)
    }

    const paged: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await entries.listEntries({ companyId: company, fiscalYearId, limit: 70, cursor })
      paged.push(...page.entries.map((e) => e.id))
      expect(page.entries.every((e) => e.lines.length >= 2)).toBe(true)
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBeGreaterThan(3)
    expect(paged).toEqual(full.entries.map((e) => e.id))

    // A cursor of another company is not one of the listed entries: first page
    const foreign = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: 'bench_c1' }, select: { id: true } })
    const first = await entries.listEntries({ companyId: company, fiscalYearId, limit: 5, cursor: foreign.id })
    expect(first.entries.map((e) => e.id)).toEqual(full.entries.slice(0, 5).map((e) => e.id))
  })

  it('transactions: pages add up to the full list, with attachments', async () => {
    const full = await transactions.listTransactions({ companyId: company })
    expect(full.transactions.length).toBe(await prisma.bankTransaction.count({ where: { bankAccount: { bankConnection: { companyId: company } } } }))
    const withAttachments = full.transactions.filter((t) => t.attachmentsCount > 0)
    expect(withAttachments.length).toBeGreaterThan(0)
    expect(withAttachments.length).toBe(await prisma.attachment.count({ where: { companyId: company } }))
    for (const t of withAttachments) expect(t.attachment?.fileName).toMatch(/\.pdf$/)

    const paged: string[] = []
    let cursor: string | null = null
    do {
      const page: { transactions: Array<{ id: string }>; nextCursor?: string } = await transactions.listTransactions({ companyId: company, limit: 90, cursor })
      paged.push(...page.transactions.map((t) => t.id))
      cursor = page.nextCursor ?? null
    } while (cursor)
    expect(paged).toEqual(full.transactions.map((t) => t.id))
  })

  it('transactions: balance before the period and categories', async () => {
    const result = await transactions.listTransactions({ companyId: company, startDate: `${openYear}-01-01`, endDate: `${openYear}-12-31` })
    const before = await prisma.bankTransaction.findMany({
      where: { bankAccountId: `${company}_ba`, date: { lt: new Date(`${openYear}-01-01`) } },
      select: { amount: true, side: true },
    })
    const expected = before.reduce((s, t) => s + (t.side === 'credit' ? 1 : -1) * Math.round(Number(t.amount) * 100), 0)
    expect(Math.round(((result as { balanceBefore?: number }).balanceBefore ?? NaN) * 100)).toBe(expected)

    const only = await transactions.listTransactions({ companyId: company, categoriesOnly: true })
    expect(only.transactions).toEqual([])
    const all = await prisma.bankTransaction.findMany({ where: { bankAccountId: `${company}_ba` }, select: { providerData: true } })
    const distinct = (pick: (p: Record<string, { name?: string } | string>) => unknown) =>
      [...new Set(all.map((t) => pick(t.providerData as Record<string, { name?: string } | string>)).filter((v): v is string => typeof v === 'string' && v !== ''))].sort()
    expect(only.categories).toEqual({
      cashflowCategories: distinct((p) => (p.cashflow_category as { name?: string })?.name),
      cashflowSubcategories: distinct((p) => (p.cashflow_subcategory as { name?: string })?.name),
      categories: distinct((p) => p.category),
      operationTypes: distinct((p) => p.operation_type),
    })
  })

  it('entries: filters select what the page filtered in the browser, page after page', async () => {
    const fiscalYearId = `${company}_fy${openYear}`
    const full = (await entries.listEntries({ companyId: company, fiscalYearId })).entries
    const cents = (v: unknown) => Math.round(Number(v) * 100)
    const amountOf = (e: (typeof full)[number]) =>
      Math.max(...(['debit', 'credit'] as const).map((side) => e.lines.reduce((s, l) => s + cents(l[side]), 0)))
    const day = (e: (typeof full)[number]) => e.date.toISOString().slice(0, 10)

    const amounts = full.map(amountOf).sort((a, b) => a - b)
    const min = amounts[Math.floor(amounts.length / 4)]
    const max = amounts[Math.floor((amounts.length * 3) / 4)]
    const bq = `${company}_jBQ`
    const cases: Array<[Parameters<typeof entries.listEntries>[0], (e: (typeof full)[number]) => boolean]> = [
      [{ companyId: company, fiscalYearId, journalId: bq }, (e) => e.journalId === bq],
      [{ companyId: company, fiscalYearId, status: 'draft' }, (e) => e.status === 'draft'],
      [{ companyId: company, fiscalYearId, number: '1' }, (e) => e.entryNumber.toLowerCase().includes('1')],
      [
        { companyId: company, fiscalYearId, search: 'tva' },
        (e) => [e.description, e.reference, ...e.lines.map((l) => l.description)].some((t) => (t ?? '').toLowerCase().includes('tva')),
      ],
      [
        { companyId: company, fiscalYearId, startDate: `${openYear}-03-01`, endDate: `${openYear}-03-31` },
        (e) => day(e) >= `${openYear}-03-01` && day(e) <= `${openYear}-03-31`,
      ],
      [{ companyId: company, fiscalYearId, minAmountCents: min, maxAmountCents: max }, (e) => amountOf(e) >= min && amountOf(e) <= max],
      [
        { companyId: company, fiscalYearId, journalId: bq, minAmountCents: min },
        (e) => e.journalId === bq && amountOf(e) >= min,
      ],
    ]
    for (const [query, keep] of cases) {
      const expected = full.filter(keep).map((e) => e.id)
      expect(expected.length, JSON.stringify(query)).toBeGreaterThan(0)
      expect(expected.length, JSON.stringify(query)).toBeLessThan(full.length)
      const paged: string[] = []
      let cursor: string | null = null
      do {
        const page = await entries.listEntries({ ...query, limit: 25, cursor })
        paged.push(...page.entries.map((e) => e.id))
        cursor = page.nextCursor
      } while (cursor)
      expect(paged, JSON.stringify(query)).toEqual(expected)
    }
  })

  it('transactions: provider categories and calendar day bounds filter in the database', async () => {
    const full = (await transactions.listTransactions({ companyId: company })).transactions
    const category = full.find((t) => t.cashflowCategory)?.cashflowCategory
    const operation = full.find((t) => t.operationType)?.operationType
    expect(category).toBeTruthy()
    expect(operation).toBeTruthy()

    const byCategory = await transactions.listTransactions({ companyId: company, cashflowCategory: category, operationType: operation })
    expect(byCategory.transactions.map((t) => t.id)).toEqual(
      full.filter((t) => t.cashflowCategory === category && t.operationType === operation).map((t) => t.id),
    )

    // The end day is included, each bound applies on its own
    const lastDay = full[full.length - 1].date.toISOString().slice(0, 10)
    const firstDay = full[0].date.toISOString().slice(0, 10)
    const upTo = await transactions.listTransactions({ companyId: company, endDate: firstDay })
    expect(upTo.transactions.map((t) => t.id)).toEqual(full.filter((t) => t.date.toISOString().slice(0, 10) <= firstDay).map((t) => t.id))
    const from = await transactions.listTransactions({ companyId: company, startDate: lastDay })
    expect(from.transactions.map((t) => t.id)).toEqual(full.filter((t) => t.date.toISOString().slice(0, 10) >= lastDay).map((t) => t.id))
    expect(from.transactions.length).toBeGreaterThan(0)

    // A period narrows the fiscal year instead of replacing it
    const fiscalYearId = `${company}_fy${openYear}`
    const inYear = await transactions.listTransactions({ companyId: company, fiscalYearId, startDate: `${openYear - 1}-06-01`, endDate: `${openYear}-02-28` })
    const days = inYear.transactions.map((t) => t.date.toISOString().slice(0, 10))
    expect(days.length).toBeGreaterThan(0)
    expect(days.every((d) => d >= `${openYear}-01-01` && d <= `${openYear}-02-28`)).toBe(true)
    expect(days.length).toBe(full.filter((t) => { const d = t.date.toISOString().slice(0, 10); return d >= `${openYear}-01-01` && d <= `${openYear}-02-28` }).length)
  })
})
