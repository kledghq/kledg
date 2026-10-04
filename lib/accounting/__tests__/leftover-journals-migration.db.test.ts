/**
 * Data migration 20261010090000_remove_leftover_journals against PostgreSQL:
 * reproduces the old GET /api/journals (it upserted AC, VT, BQ, CA and OD on
 * every read) on companies that got the canonical journals at creation, then
 * runs the migration and checks that only the unused VT "Ventes" and
 * CA "Caisse" journals are gone. Skipped without the test database server.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('leftover_journals')
})

import { prepareTestDatabase, queryAsOwner, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261010090000_remove_leftover_journals/migration.sql'),
  'utf8',
)

let prisma: typeof import('@/lib/prisma').prisma
let ensureDefaultJournals: typeof import('@/lib/accounting/default-journals').ensureDefaultJournals

/** What GET /api/journals did on every read before commit 02d803d. */
async function readJournalsPageBeforeTheFix(companyId: string) {
  const oldDefaults = [
    { code: 'AC', label: 'Achats' },
    { code: 'VT', label: 'Ventes' },
    { code: 'BQ', label: 'Banque' },
    { code: 'CA', label: 'Caisse' },
    { code: 'OD', label: 'Opérations diverses' },
  ]
  for (const journal of oldDefaults) {
    await prisma.journal.upsert({
      where: { companyId_code: { companyId, code: journal.code } },
      update: {},
      create: { companyId, ...journal },
    })
  }
}

let seq = 0
/** A company created like createCompany does it: the canonical journals. */
async function company() {
  seq += 1
  const created = await prisma.company.create({ data: { name: `Société ${seq}`, slug: `societe-${seq}`, siren: String(100000000 + seq) } })
  await ensureDefaultJournals(created.id)
  return created.id
}

async function codes(companyId: string) {
  const journals = await prisma.journal.findMany({ where: { companyId }, select: { code: true, label: true }, orderBy: { code: 'asc' } })
  return journals.map((j) => `${j.code} ${j.label}`)
}

async function draftEntryIn(companyId: string, journalCode: string) {
  const fiscalYear = await prisma.fiscalYear.create({
    data: { companyId, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  const journal = await prisma.journal.findFirstOrThrow({ where: { companyId, code: journalCode } })
  await prisma.accountingEntry.create({
    data: {
      companyId,
      fiscalYearId: fiscalYear.id,
      journalId: journal.id,
      entryNumber: 'BR-1',
      date: new Date('2026-03-02T00:00:00Z'),
      description: 'Vente comptoir',
      status: 'draft',
    },
  })
}

/** As the migrations run: with the owner's connection. */
async function runMigration() {
  await queryAsOwner('leftover_journals', MIGRATION)
}

const CANONICAL = ['AC Achats', 'AN À-nouveaux', 'BQ Banque', 'OD Opérations diverses', 'VE Ventes']

describe.skipIf(!available)('leftover journals migration', () => {
  beforeAll(async () => {
    await prepareTestDatabase('leftover_journals')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ ensureDefaultJournals } = await import('@/lib/accounting/default-journals'))
  })

  it('documents the canonical set every company gets at creation', async () => {
    const { DEFAULT_JOURNALS } = await import('@/lib/accounting/default-journals')
    expect(DEFAULT_JOURNALS.map((j) => `${j.code} ${j.label}`).sort()).toEqual(CANONICAL)
  })

  it('reproduces the old bug: 7 journals, VE and VT both named Ventes', async () => {
    const id = await company()
    await readJournalsPageBeforeTheFix(id)
    await readJournalsPageBeforeTheFix(id)
    expect(await codes(id)).toEqual(['AC Achats', 'AN À-nouveaux', 'BQ Banque', 'CA Caisse', 'OD Opérations diverses', 'VE Ventes', 'VT Ventes'])
  })

  it('removes only the unused extra journals and is idempotent', async () => {
    const affected = await company()
    await readJournalsPageBeforeTheFix(affected)

    // VT holds an entry and a rule books into CA: both are kept
    const used = await company()
    await readJournalsPageBeforeTheFix(used)
    await draftEntryIn(used, 'VT')
    await prisma.transactionRule.create({ data: { companyId: used, name: 'Dépôt espèces', journalCode: 'CA' } })

    // A user renamed the extra cash journal: it is theirs now
    const renamed = await company()
    await readJournalsPageBeforeTheFix(renamed)
    await prisma.journal.update({ where: { companyId_code: { companyId: renamed, code: 'CA' } }, data: { label: 'Caisse boutique' } })

    // VE deleted before the old read: VT is the only sales journal and stays
    const withoutVe = await company()
    await prisma.journal.delete({ where: { companyId_code: { companyId: withoutVe, code: 'VE' } } })
    await readJournalsPageBeforeTheFix(withoutVe)

    // Never opened the page: untouched
    const untouched = await company()

    const before = await prisma.journal.count()

    await runMigration()
    const afterFirstRun = await prisma.journal.count()
    await runMigration()

    // VT and CA of the company of the previous test and of `affected`, VT of
    // `renamed`, CA of `withoutVe`; unused canonical journals all stay
    expect(before - afterFirstRun).toBe(2 + 2 + 1 + 1)
    expect(await prisma.journal.count()).toBe(afterFirstRun)
    expect(await codes(affected)).toEqual(CANONICAL)
    expect(await codes(used)).toEqual(['AC Achats', 'AN À-nouveaux', 'BQ Banque', 'CA Caisse', 'OD Opérations diverses', 'VE Ventes', 'VT Ventes'])
    expect(await codes(renamed)).toEqual(['AC Achats', 'AN À-nouveaux', 'BQ Banque', 'CA Caisse boutique', 'OD Opérations diverses', 'VE Ventes'])
    expect(await codes(withoutVe)).toEqual(['AC Achats', 'AN À-nouveaux', 'BQ Banque', 'OD Opérations diverses', 'VT Ventes'])
    expect(await codes(untouched)).toEqual(CANONICAL)
  })

  it('checks every column that can refer to a journal', async () => {
    // The migration keeps journals used by entries (journalId) and rules
    // (journalCode). A new column naming a journal must be added to its
    // NOT EXISTS checks, in a new migration if this one has shipped.
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ILIKE '%journal%'
      ORDER BY table_name, column_name`
    expect(columns.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      'accounting_entries.journalId',
      'transaction_rules.journalCode',
    ])
    // information_schema shows constraints of the tables the role owns: read as the owner.
    const foreignKeys = await queryAsOwner<{ table_name: string }>(
      'leftover_journals',
      `SELECT tc.table_name FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'journals'`,
    )
    expect(foreignKeys.map((f) => f.table_name)).toEqual(['accounting_entries'])
  })
})
