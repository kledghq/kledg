/**
 * Entry life cycle against PostgreSQL (see lib/__tests__/helpers/test-db.ts;
 * skipped without the server): validated entries are definitive (PCG art.
 * 1031-3) in the services AND in the database (triggers), numbers are
 * assigned at validation without gaps or collisions (LPF art. A47 A-1,
 * BOI-CF-IOR-60-40-20 § 100 and § 250), amounts are exact cents, dates are
 * calendar days, and closed fiscal years accept no entry.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('entry_lifecycle')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let errors: typeof import('@/lib/accounting/errors')

const ids = {} as Record<string, string>

async function seed() {
  await prepareTestDatabase('entry_lifecycle')
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
  const fy2024 = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2024, startDate: new Date('2024-01-01T00:00:00Z'), endDate: new Date('2024-12-31T00:00:00Z') },
  })
  // Bounds stored at local midnight in Paris (23:00 UTC the day before), as older code did
  const fy2025 = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: new Date('2024-12-31T23:00:00Z'), endDate: new Date('2025-12-30T23:00:00Z') },
  })
  const fy2026 = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
  for (const fy of [fy2024, fy2025, fy2026]) {
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    ids[`bank${fy.year}`] = bank.id
    ids[`sales${fy.year}`] = sales.id
  }
  Object.assign(ids, { company: company.id, journal: journal.id, fy2024: fy2024.id, fy2025: fy2025.id, fy2026: fy2026.id })
}

const lines = (year: number, amount: number | string = '100.00') => [
  { accountId: ids[`bank${year}`], debit: amount, credit: 0 },
  { accountId: ids[`sales${year}`], debit: 0, credit: amount },
]

const draft = (date = '2025-03-10', amount: number | string = '100.00') =>
  svc.createEntry({ companyId: ids.company, journalId: ids.journal, date, description: 'Vente', lines: lines(Number(date.slice(0, 4)), amount) })

describe.skipIf(!available)('entry life cycle (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('entry_lifecycle')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    errors = await import('@/lib/accounting/errors')
  })
  beforeEach(seed)
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('numbering at validation', () => {
    it('gives drafts a provisional number and numbers entries 1, 2, 3 when validated', async () => {
      const a = await draft('2025-03-10')
      const b = await draft('2025-03-11')
      expect(a.entryNumber).toMatch(/^BR-/)
      expect(a.status).toBe('draft')
      expect(a.validatedAt).toBeNull()

      const { validated } = await svc.validateEntries(ids.company, [b.id, a.id])
      // Validated in date order within one request
      expect(validated.map((e) => [e.id, e.entryNumber])).toEqual([[a.id, '1'], [b.id, '2']])
      expect(validated.every((e) => e.validatedAt instanceof Date)).toBe(true)
      // Lines follow the number (composite foreign key)
      const lineNumbers = await prisma.entryLine.findMany({ where: { accountingEntryId: a.id }, select: { accountingEntryNumber: true } })
      expect(lineNumbers.every((l) => l.accountingEntryNumber === '1')).toBe(true)
    })

    it('never leaves a gap when a draft is deleted', async () => {
      const [a, b, c] = [await draft(), await draft(), await draft()]
      await svc.deleteDraftEntry(ids.company, b.id)
      await svc.validateEntries(ids.company, [a.id, c.id])
      const numbers = await prisma.accountingEntry.findMany({ where: { status: 'validated' }, select: { entryNumber: true } })
      expect(numbers.map((n) => n.entryNumber).sort()).toEqual(['1', '2'])
    })

    it('numbers concurrent validations without collision nor gap', async () => {
      const drafts = await Promise.all(Array.from({ length: 12 }, (_, i) => draft(`2025-04-${String(i + 1).padStart(2, '0')}`)))
      const results = await Promise.all(drafts.map((d) => svc.validateEntries(ids.company, [d.id])))
      expect(results.every((r) => r.errors.length === 0)).toBe(true)
      const numbers = (await prisma.accountingEntry.findMany({ where: { fiscalYearId: ids.fy2025 }, select: { entryNumber: true } }))
        .map((e) => Number(e.entryNumber))
        .sort((x, y) => x - y)
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    })

    it('restarts at 1 in each fiscal year', async () => {
      const a = await draft('2025-06-01')
      const b = await draft('2026-01-01')
      const { validated } = await svc.validateEntries(ids.company, [a.id, b.id])
      expect(validated.map((e) => e.entryNumber)).toEqual(['1', '1'])
      expect(validated.map((e) => e.fiscalYearId)).toEqual([ids.fy2025, ids.fy2026])
    })

    it('ignores legacy numbers longer than 9 digits and renumbers a draft holding the next number', async () => {
      // Legacy validated entry "TR-<timestamp>" and a reconciliation draft numbered "2"
      const legacy = await draft()
      await prisma.accountingEntry.update({ where: { id: legacy.id }, data: { entryNumber: 'TR-1727000000000' } })
      await prisma.accountingEntry.update({ where: { id: legacy.id }, data: { status: 'validated' } })
      const first = await draft()
      await svc.validateEntries(ids.company, [first.id])
      const reconciliationDraft = await draft()
      await prisma.accountingEntry.update({ where: { id: reconciliationDraft.id }, data: { entryNumber: '2' } })

      const next = await draft()
      const { validated } = await svc.validateEntries(ids.company, [next.id])
      expect(validated[0].entryNumber).toBe('2')
      const moved = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: reconciliationDraft.id } })
      expect(moved.entryNumber).toMatch(/^BR-/)
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: first.id } })).entryNumber).toBe('1')
    })

    it('validates directly when created with status "validated"', async () => {
      const entry = await svc.createEntry({ companyId: ids.company, journalId: ids.journal, date: '2025-02-01', description: 'Directe', status: 'validated', lines: lines(2025) })
      expect(entry).toMatchObject({ status: 'validated', entryNumber: '1' })
    })
  })

  describe('validated entries are definitive', () => {
    let validatedId: string
    beforeEach(async () => {
      const entry = await draft()
      await svc.validateEntries(ids.company, [entry.id])
      validatedId = entry.id
    })

    it('refuses edits, deletion and going back to draft in the services (409)', async () => {
      await expect(svc.updateDraftEntry(validatedId, { description: 'Changée' })).rejects.toThrow(errors.ConflictError)
      await expect(svc.updateDraftEntry(validatedId, { status: 'draft' })).rejects.toThrow(/contre-passation/)
      await expect(svc.updateDraftEntry(validatedId, { lines: lines(2025, '200.00') })).rejects.toThrow(errors.ConflictError)
      await expect(svc.deleteDraftEntry(ids.company, validatedId)).rejects.toThrow(/PCG art. 1031-3/)
      await expect(svc.validateEntries(ids.company, [validatedId])).resolves.toMatchObject({ errors: [{ error: expect.stringContaining('déjà validée') }] })
    })

    it('refuses any change in the database itself, whatever the code path', async () => {
      const attempts = [
        prisma.accountingEntry.update({ where: { id: validatedId }, data: { description: 'Changée' } }),
        prisma.accountingEntry.update({ where: { id: validatedId }, data: { date: new Date('2025-03-11T00:00:00Z') } }),
        prisma.accountingEntry.update({ where: { id: validatedId }, data: { status: 'draft' } }),
        prisma.accountingEntry.delete({ where: { id: validatedId } }),
        prisma.accountingEntry.deleteMany({ where: { id: validatedId } }),
        prisma.entryLine.updateMany({ where: { accountingEntryId: validatedId }, data: { debit: 0 } }),
        prisma.entryLine.deleteMany({ where: { accountingEntryId: validatedId } }),
        prisma.entryLine.create({
          data: { accountingEntryId: validatedId, accountingEntryNumber: '1', accountId: ids.bank2025, accountFiscalYearId: ids.fy2025, debit: 1 },
        }),
      ]
      for (const attempt of attempts) {
        const error = await attempt.then(() => null, (e: unknown) => e)
        expect(error).not.toBeNull()
        expect(errors.handleError(error)).toEqual({
          message: expect.stringMatching(/^Écriture validée n° 1 : .+ \(PCG art\. 1031-3\)\. Passez une écriture de contre-passation\.$/),
          statusCode: 409,
        })
      }
      const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: validatedId }, include: { lines: true } })
      expect(entry).toMatchObject({ description: 'Vente', status: 'validated' })
      expect(entry.lines.map((l) => l.debit.toString()).sort()).toEqual(['0', '100'])
    })

    it('still accepts lettrage on validated lines', async () => {
      await prisma.entryLine.updateMany({
        where: { accountingEntryId: validatedId },
        data: { letteringCode: 'AA', letteringDate: new Date('2025-04-01T00:00:00Z') },
      })
      expect(await prisma.entryLine.count({ where: { accountingEntryId: validatedId, letteringCode: 'AA' } })).toBe(2)
    })

    it('refuses in the database to validate an unbalanced entry or one without a definitive number', async () => {
      const d = await draft()
      await prisma.entryLine.updateMany({ where: { accountingEntryId: d.id, credit: { gt: 0 } }, data: { credit: '99.99' } })
      const unbalanced = await prisma.accountingEntry.update({ where: { id: d.id }, data: { status: 'validated', entryNumber: '9' } }).catch((e) => e)
      expect(errors.handleError(unbalanced)).toMatchObject({ statusCode: 400, message: expect.stringContaining('non équilibrée') })
      const provisional = await prisma.accountingEntry.update({ where: { id: (await draft()).id }, data: { status: 'validated' } }).catch((e) => e)
      expect(errors.handleError(provisional).message).toContain('numéro définitif')
    })
  })

  describe('contre-passation', () => {
    it('creates the reversing entry, validated and linked, debits and credits swapped', async () => {
      const original = await draft('2025-03-10', '123.45')
      await svc.validateEntries(ids.company, [original.id])
      const reversal = await svc.reverseEntry(ids.company, original.id)
      expect(reversal).toMatchObject({
        status: 'validated',
        entryNumber: '2',
        reversalOfId: original.id,
        description: "Contre-passation de l'écriture n° 1 : Vente",
        date: new Date('2025-03-10T00:00:00Z'),
      })
      expect(reversal.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()])).toEqual([
        ['512000', '0', '123.45'],
        ['706000', '123.45', '0'],
      ])
      const reloaded = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: original.id }, include: { reversedBy: true } })
      expect(reloaded.reversedBy?.id).toBe(reversal.id)
      // Once only
      await expect(svc.reverseEntry(ids.company, original.id)).rejects.toThrow(/déjà contre-passée par l'écriture n° 2/)
    })

    it('refuses to reverse a draft', async () => {
      const d = await draft()
      await expect(svc.reverseEntry(ids.company, d.id)).rejects.toThrow(/Seule une écriture validée/)
    })

    it('reverses an entry of a closed year on a chosen day of an open year, accounts taken by number', async () => {
      const old = await svc.createEntry({ companyId: ids.company, journalId: ids.journal, date: '2024-06-01', description: 'Ancienne', status: 'validated', lines: lines(2024) })
      await prisma.fiscalYear.update({ where: { id: ids.fy2024 }, data: { isClosed: true } })
      await expect(svc.reverseEntry(ids.company, old.id)).rejects.toThrow(/L'exercice 2024 est clôturé/)
      const reversal = await svc.reverseEntry(ids.company, old.id, { date: '2025-01-02' })
      expect(reversal.fiscalYearId).toBe(ids.fy2025)
      expect(reversal.lines.map((l) => l.accountId).sort()).toEqual([ids.bank2025, ids.sales2025].sort())
      await expect(svc.reverseEntry(ids.company, (await draft()).id, { date: '2030-01-01' })).rejects.toThrow()
    })
  })

  describe('closed fiscal years (single guard)', () => {
    it('refuses to create, edit, validate or delete entries in a closed year', async () => {
      const d = await draft('2025-05-05')
      await prisma.fiscalYear.update({ where: { id: ids.fy2025 }, data: { isClosed: true } })
      const closed = /L'exercice 2025 est clôturé/
      await expect(draft('2025-05-06')).rejects.toThrow(closed)
      await expect(svc.updateDraftEntry(d.id, { description: 'x' })).rejects.toThrow(closed)
      await expect(svc.deleteDraftEntry(ids.company, d.id)).rejects.toThrow(closed)
      const { errors: validationErrors } = await svc.validateEntries(ids.company, [d.id])
      expect(validationErrors[0].error).toMatch(closed)
    })

    it('refuses a date outside the fiscal year of the accounts', async () => {
      await expect(
        svc.createEntry({ companyId: ids.company, journalId: ids.journal, date: '2026-01-01', description: 'x', lines: lines(2025) }),
      ).rejects.toThrow(/hors de l'exercice 2025 \(du 01\/01\/2025 au 31\/12\/2025\)/)
    })
  })

  describe('exact amounts', () => {
    it('stores 0.1 + 0.2 = 0.3 exactly and refuses three decimals', async () => {
      const entry = await svc.createEntry({
        companyId: ids.company,
        journalId: ids.journal,
        date: '2025-03-10',
        description: 'Centimes',
        status: 'validated',
        lines: [
          { accountId: ids.bank2025, debit: 0.1, credit: 0 },
          { accountId: ids.bank2025, debit: 0.2, credit: 0 },
          { accountId: ids.sales2025, debit: 0, credit: 0.3 },
        ],
      })
      expect(entry.lines.map((l) => l.debit.toString())).toEqual(['0.1', '0.2', '0'])
      await expect(draft('2025-03-10', '10.005')).rejects.toThrow(/deux décimales/)
      await expect(
        svc.createEntry({ companyId: ids.company, journalId: ids.journal, date: '2025-03-10', description: 'x', lines: [lines(2025, '100.00')[0], { ...lines(2025, '99.99')[1] }] }),
      ).rejects.toThrow(/écart 0,01 €/)
    })

    it('stores the largest Decimal(15, 2) amount exactly', async () => {
      const entry = await draft('2025-03-10', '9999999999999.99')
      expect(entry.lines[0].debit.toString()).toBe('9999999999999.99')
    })
  })

  describe('calendar dates whatever the server timezone', () => {
    const originalTz = process.env.TZ
    afterEach(() => {
      process.env.TZ = originalTz
    })

    it.each(['Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Paris', 'UTC'])('keeps 31/12 in 2025 and 01/01 in 2026 (TZ=%s)', async (tz) => {
      process.env.TZ = tz
      const last = await draft('2025-12-31')
      expect(last.date.toISOString()).toBe('2025-12-31T00:00:00.000Z')
      expect(last.fiscalYearId).toBe(ids.fy2025)
      // A date picker value (local midnight) means the same day
      const local = await svc.createEntry({ companyId: ids.company, journalId: ids.journal, date: new Date(2025, 11, 31), description: 'x', lines: lines(2025) })
      expect(local.date.toISOString()).toBe('2025-12-31T00:00:00.000Z')
      await expect(draft('2026-01-01')).resolves.toMatchObject({ fiscalYearId: ids.fy2026 })
      await expect(
        svc.createEntry({ companyId: ids.company, journalId: ids.journal, date: '2026-01-01', description: 'x', lines: lines(2025) }),
      ).rejects.toThrow(/hors de l'exercice 2025/)
    })
  })
})
