/**
 * Entry services against PostgreSQL (skipped without the test database
 * server): createAccountingEntry and updateAccountingEntry (the public
 * wrappers of the life cycle), the entry operations of the API (read,
 * duplicate, bulk delete and status), and calculateAccountBalance. Validated
 * entries are definitive (PCG art. 1031-3): updated, deleted or put back to
 * draft, they are refused with the French message; numbers are assigned at
 * validation; balances are exact sums in cents of validated entries only.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_entry_services')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let createAccountingEntry: typeof import('@/lib/accounting/services/create-accounting-entry.service').createAccountingEntry
let updateAccountingEntry: typeof import('@/lib/accounting/services/update-accounting-entry.service').updateAccountingEntry
let ops: typeof import('@/lib/accounting/services/entry-operations.service')
let calculateAccountBalance: typeof import('@/lib/accounting/services/calculate-account-balance.service').calculateAccountBalance

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  await prepareTestDatabase('cov_entry_services')
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
  const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'VE', label: 'Ventes' } })
  const od = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
  const account = async (code: string) => (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label: code } })).id
  Object.assign(ids, {
    company: company.id,
    other: other.id,
    fy: fy.id,
    journal: journal.id,
    od: od.id,
    client: await account('411000'),
    sales: await account('706000'),
    vat: await account('445710'),
    bank: await account('512000'),
  })
}

/** A sale of `ttc` with 20 % VAT (CGI art. 278). */
const sale = (date: string, ht: string, vat: string, ttc: string, status: 'draft' | 'validated' = 'draft') =>
  createAccountingEntry({
    companyId: ids.company,
    journalId: ids.journal,
    date,
    description: `Facture du ${date}`,
    reference: 'F-1',
    status,
    entryNumber: 'IGNORE-ME',
    lines: [
      { accountId: ids.client, debit: ttc, credit: 0, description: 'Client' },
      { accountId: ids.sales, debit: 0, credit: ht },
      { accountId: ids.vat, debit: 0, credit: vat },
    ],
  })

describe.skipIf(!available)('entry services (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_entry_services')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ createAccountingEntry } = await import('@/lib/accounting/services/create-accounting-entry.service'))
    ;({ updateAccountingEntry } = await import('@/lib/accounting/services/update-accounting-entry.service'))
    ops = await import('@/lib/accounting/services/entry-operations.service')
    ;({ calculateAccountBalance } = await import('@/lib/accounting/services/calculate-account-balance.service'))
  })
  beforeEach(seed)
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('createAccountingEntry and updateAccountingEntry', () => {
    it('creates a draft, edits it, validates it, then refuses any change', async () => {
      const draft = await sale('2025-02-10', '100.00', '20.00', '120.00')
      expect(draft).toMatchObject({ status: 'draft', fiscalYearId: ids.fy, description: 'Facture du 2025-02-10' })
      expect(draft.entryNumber).toMatch(/^BR-/)

      const edited = await updateAccountingEntry(
        draft.id,
        {
          journalId: ids.od,
          date: '2025-02-11',
          description: 'Facture 12',
          reference: 'F-12',
          pieceDate: '2025-02-09',
          lines: [
            { accountId: ids.client, debit: '240.00', credit: 0 },
            { accountId: ids.sales, debit: 0, credit: '200.00' },
            { accountId: ids.vat, debit: 0, credit: '40.00' },
          ],
        },
        ids.company,
      )
      expect([edited.journalId, edited.date.toISOString(), edited.description, edited.reference, edited.pieceDate?.toISOString()]).toEqual([
        ids.od,
        '2025-02-11T00:00:00.000Z',
        'Facture 12',
        'F-12',
        '2025-02-09T00:00:00.000Z',
      ])
      expect(edited.lines.map((l) => [l.accountId, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
        [ids.client, '240.00', '0.00'],
        [ids.sales, '0.00', '200.00'],
        [ids.vat, '0.00', '40.00'],
      ])

      // Validation gives the definitive number in the fiscal year sequence (PCG art. 1031-3)
      const validated = await updateAccountingEntry(draft.id, { status: 'validated' })
      expect(validated).toMatchObject({ status: 'validated', entryNumber: '1' })

      await expect(updateAccountingEntry(draft.id, { description: 'Modifiée' })).rejects.toMatchObject({
        statusCode: 409,
        message: "L'écriture n° 1 est validée : elle ne peut plus être modifiée ni supprimée (PCG art. 1031-3). Passez une écriture de contre-passation.",
      })
    })

    it('refuses an unbalanced draft, an entry of another company and an unknown status', async () => {
      const draft = await sale('2025-02-10', '100.00', '20.00', '120.00')
      await expect(
        updateAccountingEntry(draft.id, {
          lines: [
            { accountId: ids.client, debit: '120.00', credit: 0 },
            { accountId: ids.sales, debit: 0, credit: '119.99' },
          ],
        }),
      ).rejects.toMatchObject({ statusCode: 400 })
      await expect(updateAccountingEntry(draft.id, { description: 'x' }, ids.other)).rejects.toMatchObject({ statusCode: 404, message: 'Écriture introuvable' })
      await expect(updateAccountingEntry(draft.id, { status: 'archived' as 'draft' })).rejects.toThrow('Le statut doit être "draft" ou "validated"')
      // Nothing changed
      const unchanged = await ops.getCompanyEntry(ids.company, draft.id)
      expect(unchanged.lines.map((l) => l.debit.toFixed(2))).toEqual(['120.00', '0.00', '0.00'])
    })

    it('refuses to create an unbalanced entry', async () => {
      await expect(sale('2025-02-10', '100.00', '20.00', '120.01')).rejects.toMatchObject({ statusCode: 400 })
      expect(await prisma.accountingEntry.count()).toBe(0)
    })
  })

  describe('entry operations', () => {
    it('reads an entry and its status only within its company', async () => {
      const draft = await sale('2025-03-01', '50.00', '10.00', '60.00')
      expect((await ops.getCompanyEntry(ids.company, draft.id)).journal.code).toBe('VE')
      expect(await ops.getEntryStatus(ids.company, draft.id)).toBe('draft')
      await expect(ops.getCompanyEntry(ids.other, draft.id)).rejects.toMatchObject({ statusCode: 404, message: ops.ENTRY_NOT_FOUND })
      await expect(ops.getEntryStatus(ids.other, draft.id)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('duplicates a validated entry as a new draft with the same lines', async () => {
      const source = await sale('2025-03-01', '50.00', '10.00', '60.00', 'validated')

      const copy = await ops.duplicateEntry(ids.company, source.id)

      expect(copy.id).not.toBe(source.id)
      expect([copy.status, copy.journalId, copy.date.toISOString(), copy.description, copy.reference]).toEqual([
        'draft',
        ids.journal,
        '2025-03-01T00:00:00.000Z',
        'Facture du 2025-03-01',
        'F-1',
      ])
      expect(copy.entryNumber).toMatch(/^BR-/)
      expect(copy.lines.map((l) => [l.accountId, l.debit.toFixed(2), l.credit.toFixed(2), l.description])).toEqual([
        [ids.client, '60.00', '0.00', 'Client'],
        [ids.sales, '0.00', '50.00', null],
        [ids.vat, '0.00', '10.00', null],
      ])
      await expect(ops.duplicateEntry(ids.other, source.id)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('deletes drafts one by one and reports validated, foreign and invalid ids', async () => {
      const a = await sale('2025-03-01', '50.00', '10.00', '60.00')
      const b = await sale('2025-03-02', '50.00', '10.00', '60.00', 'validated')

      const result = await ops.deleteDraftEntries(ids.company, [a.id, b.id, 'missing', 42, ''])

      expect(result.deleted).toEqual([{ id: a.id, description: 'Facture du 2025-03-01', reference: 'F-1' }])
      expect(result.errors).toEqual([
        { entryId: b.id, error: `L'écriture n° ${b.entryNumber} est validée : elle ne peut plus être modifiée ni supprimée (PCG art. 1031-3). Passez une écriture de contre-passation.` },
        { entryId: 'missing', error: 'Écriture introuvable' },
        { entryId: 42, error: 'Écriture introuvable' },
        { entryId: '', error: 'Écriture introuvable' },
      ])
      expect(await prisma.accountingEntry.count()).toBe(1)
    })

    it('validates drafts in date order and refuses to put any entry back to draft', async () => {
      const later = await sale('2025-04-20', '10.00', '2.00', '12.00')
      const earlier = await sale('2025-04-01', '10.00', '2.00', '12.00')

      const { validated, errors } = await ops.setEntriesStatus(ids.company, [later.id, earlier.id, null], 'validated')

      // Definitive numbers follow the dates
      expect(validated.map((e) => [e.id, e.entryNumber])).toEqual([
        [earlier.id, '1'],
        [later.id, '2'],
      ])
      expect(errors).toEqual([{ entryId: null, error: 'Écriture introuvable' }])

      const draft = await sale('2025-05-01', '10.00', '2.00', '12.00')
      const back = await ops.setEntriesStatus(ids.company, [earlier.id, draft.id, 'missing'], 'draft')
      expect(back).toEqual({
        validated: [],
        errors: [
          { entryId: earlier.id, error: "L'écriture n° 1 est validée : elle ne peut plus être modifiée ni supprimée (PCG art. 1031-3). Passez une écriture de contre-passation." },
          { entryId: draft.id, error: "L'écriture est déjà un brouillon." },
          { entryId: 'missing', error: 'Écriture introuvable' },
        ],
      })
    })
  })

  describe('calculateAccountBalance', () => {
    beforeEach(async () => {
      // 0,10 + 0,20 must give 0,30 exactly, not 0,30000000000000004
      await sale('2025-01-15', '0.10', '0.02', '0.12', 'validated')
      await sale('2025-02-15', '0.20', '0.04', '0.24', 'validated')
      await sale('2025-03-15', '1000.00', '200.00', '1200.00', 'validated')
      await sale('2025-03-20', '999.00', '199.80', '1198.80') // draft: not counted
      // Payment of the January invoice
      await createAccountingEntry({
        companyId: ids.company,
        journalId: ids.od,
        date: '2025-03-31',
        description: 'Encaissement',
        status: 'validated',
        lines: [
          { accountId: ids.bank, debit: '0.12', credit: 0 },
          { accountId: ids.client, debit: 0, credit: '0.12' },
        ],
      })
    })

    it('sums validated lines exactly, in euros, debit minus credit', async () => {
      expect(await calculateAccountBalance(ids.sales, ids.company)).toEqual({ debit: 0, credit: 1000.3, balance: -1000.3 })
      expect(await calculateAccountBalance(ids.client, ids.company)).toEqual({ debit: 1200.36, credit: 0.12, balance: 1200.24 })
    })

    it('limits the income statement balance to the period and the balance sheet balance to its end', async () => {
      const q1 = { startDate: day('2025-02-01'), endDate: day('2025-03-15') }
      // Income statement (period): February and March 15 invoices
      expect(await calculateAccountBalance(ids.sales, ids.company, q1)).toEqual({ debit: 0, credit: 1000.2, balance: -1000.2 })
      // Balance sheet (cumulative up to the end date): January included, March 31 payment excluded
      expect(await calculateAccountBalance(ids.client, ids.company, q1, true)).toEqual({ debit: 1200.36, credit: 0, balance: 1200.36 })
    })

    it('ignores another company', async () => {
      expect(await calculateAccountBalance(ids.sales, ids.other)).toEqual({ debit: 0, credit: 0, balance: 0 })
    })
  })
})
