/**
 * Data migration 20261011100000_map_unmapped_bank_accounts against
 * PostgreSQL: bank accounts without a 512 account get the company's default
 * bank account or its only euro 512 account (5121 in the default chart, not
 * 5124 comptes en devises); several 512 accounts
 * without a default, or an existing mapping, are left alone. Skipped without
 * the test database server.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('map_unmapped_bank_accounts')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261011100000_map_unmapped_bank_accounts/migration.sql'),
  'utf8',
)

let prisma: typeof import('@/lib/prisma').prisma

let seq = 0
/** A company with a 2025 closed year and a 2026 open year holding `codes`, and one unmapped bank account. */
async function company(codes: string[], options: { defaultBankAccountCode?: string; mapped?: string; closedCodes?: string[] } = {}) {
  seq += 1
  const created = await prisma.company.create({
    data: { name: `Société ${seq}`, slug: `societe-${seq}`, siren: String(100000000 + seq), defaultBankAccountCode: options.defaultBankAccountCode },
  })
  const closed = await prisma.fiscalYear.create({
    data: { companyId: created.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
  })
  const open = await prisma.fiscalYear.create({
    data: { companyId: created.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  for (const code of options.closedCodes ?? []) {
    await prisma.account.create({ data: { companyId: created.id, fiscalYearId: closed.id, code, label: code } })
  }
  for (const code of codes) await prisma.account.create({ data: { companyId: created.id, fiscalYearId: open.id, code, label: code } })
  await prisma.fiscalYear.update({ where: { id: closed.id }, data: { isClosed: true, closedAt: new Date('2026-03-01T00:00:00Z') } })
  const connection = await prisma.bankConnection.create({ data: { companyId: created.id, provider: 'QONTO' } })
  const account = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: `acc-${seq}`, name: `compte-${seq}`, ledgerAccountCode: options.mapped ?? null },
  })
  return account.id
}

const code = async (id: string) => (await prisma.bankAccount.findUniqueOrThrow({ where: { id } })).ledgerAccountCode

describe.skipIf(!available)('migration 20261011100000_map_unmapped_bank_accounts', () => {
  beforeAll(async () => {
    await prepareTestDatabase('map_unmapped_bank_accounts')
    ;({ prisma } = await import('@/lib/prisma'))
  }, 60_000)

  it('maps only when the company has no choice to make, on its open fiscal year', async () => {
    const single = await company(['512', '512000'], { closedCodes: ['512000', '512100'] })
    const defaultChart = await company(['512', '5121', '5124'])
    const byDefault = await company(['512000', '512100'], { defaultBankAccountCode: '512100' })
    const ambiguous = await company(['512000', '512100'])
    const none = await company(['401000'])
    const alreadyMapped = await company(['512000', '512100'], { mapped: '512100', defaultBankAccountCode: '512000' })

    await prisma.$executeRawUnsafe(MIGRATION)
    // Idempotent
    await prisma.$executeRawUnsafe(MIGRATION)

    expect(await code(single)).toBe('512000')
    expect(await code(defaultChart)).toBe('5121')
    expect(await code(byDefault)).toBe('512100')
    expect(await code(ambiguous)).toBeNull()
    expect(await code(none)).toBeNull()
    expect(await code(alreadyMapped)).toBe('512100')
  })
})
