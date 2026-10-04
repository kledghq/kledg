/**
 * The default statement layouts are created on the first report of a company
 * and variant. Two reports computed at once (a N vs N-1 comparison, two users,
 * the balance sheet and its check against the income statement) must create
 * one layout, not one each: a duplicated layout has every line twice, an
 * account goes to one copy (ties are broken by line id) while a reader of the
 * first line by form code sees the other one at 0,00.
 *
 * Regression of the flaky "form 2050" test of statement-exports.db.test.ts:
 * a comparison answering 404 left its other balance sheet running, which
 * created the complete layout while the next test created it too.
 *
 * Skipped without the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('rep_default_layout')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { generateBalanceSheetComparison } from '@/lib/reports/balance-sheet/generate-comparison.service'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import { createDefaultBalanceSheetConfig } from '@/lib/reports/balance-sheet/config/create-default-pcg-config.service'
import { createDefaultIncomeStatementConfig } from '@/lib/reports/income-statement/config/create-default-pcg-config.service'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
let counter = 0

async function freshCompany() {
  counter += 1
  const company = await prisma.company.create({
    data: { name: `Société ${counter}`, slug: `societe-${counter}`, siren: String(100000000 + counter) },
  })
  const fy2024 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2024, startDate: day('2024-01-01'), endDate: day('2024-12-31') } })
  const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  return { companyId: company.id, fy2024: fy2024.id, fy2025: fy2025.id }
}

/** Rows of the default layout of a variant, created once in a company of reference. */
const expectedRows = new Map<string, number>()

async function balanceSheetRows(companyId: string, reportVariant: 'complete' | 'simplified') {
  return prisma.balanceSheetLineConfig.count({ where: { companyId, reportVariant } })
}

async function incomeStatementRows(companyId: string, reportVariant: 'complete' | 'simplified') {
  return prisma.incomeStatementLineConfig.count({ where: { companyId, reportVariant } })
}

describe.skipIf(!available)('creation of the default statement layouts', () => {
  beforeAll(async () => {
    await prepareTestDatabase('rep_default_layout')
    ;({ prisma } = await import('@/lib/prisma'))
    const reference = await freshCompany()
    for (const variant of ['complete', 'simplified'] as const) {
      await createDefaultBalanceSheetConfig(reference.companyId, variant)
      await createDefaultIncomeStatementConfig(reference.companyId, variant)
      expectedRows.set(`bs:${variant}`, await balanceSheetRows(reference.companyId, variant))
      expectedRows.set(`is:${variant}`, await incomeStatementRows(reference.companyId, variant))
    }
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it.each(['complete', 'simplified'] as const)('creates one %s balance sheet layout for two reports computed at once', async (variant) => {
    const { companyId, fy2024, fy2025 } = await freshCompany()
    await Promise.all([generateBalanceSheet(companyId, fy2025, variant), generateBalanceSheet(companyId, fy2024, variant)])
    expect(await balanceSheetRows(companyId, variant)).toBe(expectedRows.get(`bs:${variant}`))
  })

  it.each(['complete', 'simplified'] as const)('creates one %s income statement layout for two reports computed at once', async (variant) => {
    const { companyId, fy2024, fy2025 } = await freshCompany()
    await Promise.all([generateIncomeStatement(companyId, fy2025, variant), generateIncomeStatement(companyId, fy2024, variant)])
    expect(await incomeStatementRows(companyId, variant)).toBe(expectedRows.get(`is:${variant}`))
  })

  it('creates one layout for a N vs N-1 comparison, so every line carries its accounts', async () => {
    const { companyId, fy2024, fy2025 } = await freshCompany()
    const { current } = await generateBalanceSheetComparison(companyId, fy2025, fy2024, 'complete')
    expect(await balanceSheetRows(companyId, 'complete')).toBe(expectedRows.get('bs:complete'))
    const codes: string[] = []
    const visit = (lines: typeof current.actif.lines) => {
      for (const line of lines) {
        if (line.formCode) codes.push(line.formCode)
        visit(line.children ?? [])
      }
    }
    visit([...current.actif.lines, ...current.passif.lines])
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.filter((code, i) => codes.indexOf(code) !== i)).toEqual([])
  })

  it('answers 404 for a fiscal year of another company before computing anything', async () => {
    const { companyId, fy2025 } = await freshCompany()
    const other = await freshCompany()
    await expect(generateBalanceSheetComparison(companyId, fy2025, other.fy2024, 'complete')).rejects.toThrow('Exercice fiscal introuvable')
    await expect(generateBalanceSheetComparison(companyId, other.fy2024, fy2025, 'complete')).rejects.toThrow('Exercice fiscal introuvable')
    // Nothing left running in the background: no layout appears afterwards.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await balanceSheetRows(companyId, 'complete')).toBe(0)
  })
})
