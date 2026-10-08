/**
 * Automatic bank reconciliation against PostgreSQL
 * (lib/services/banking/reconciliation-service.ts, skipped without the test
 * database server): a bank line of an entry (class 51, PCG art. 932-1)
 * matches a transaction of the same amount to the cent, on the opposite side,
 * within one calendar day; one entry reconciles one transaction, a
 * transaction whose entry was deleted is released, and a second run links
 * nothing twice. The FEC import uses the same matcher (KLEDG-R3-QUAL-04) and
 * a failure is reported, not read as "nothing matched" (KLEDG-R3-QUAL-18).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_auto_reconcile')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/services/banking/reconciliation-service')
let createEntry: typeof import('@/lib/accounting/services/entry-lifecycle.service').createEntry

const ids = {} as Record<string, string>
let counter = 0
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  await prepareTestDatabase('cov_auto_reconcile')
  counter = 0
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const bq = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const od = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })
  const account = async (code: string) => (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label: code } })).id
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: 'login', secretKeyEncrypted: 'encrypted' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'ext', name: 'Compte courant' } })
  Object.assign(ids, {
    company: company.id,
    bq: bq.id,
    od: od.id,
    bank: await account('512000'),
    client: await account('411000'),
    supplier: await account('401000'),
    bankAccount: bankAccount.id,
  })
}

async function transaction(amount: string, side: 'debit' | 'credit', date: string, extra: Record<string, unknown> = {}) {
  counter += 1
  return (
    await prisma.bankTransaction.create({
      data: { bankAccountId: ids.bankAccount, externalTransactionId: `t-${counter}`, amount, side, date: day(date), label: `Opération ${counter}`, ...extra },
    })
  ).id
}

/** Money in: 512 debit / 411 credit. Money out: 401 debit / 512 credit. */
async function entry(direction: 'in' | 'out', amount: string, date: string, journalId = ids.bq) {
  const lines =
    direction === 'in'
      ? [
          { accountId: ids.bank, debit: amount, credit: 0 },
          { accountId: ids.client, debit: 0, credit: amount },
        ]
      : [
          { accountId: ids.supplier, debit: amount, credit: 0 },
          { accountId: ids.bank, debit: 0, credit: amount },
        ]
  return (await createEntry({ companyId: ids.company, journalId, date, description: `${direction} ${amount}`, status: 'validated', lines })).id
}

const reconciledWith = async (transactionId: string) =>
  (await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId }, select: { reconciledWith: true } })).reconciledWith

describe.skipIf(!available)('automatic bank reconciliation (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_auto_reconcile')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/services/banking/reconciliation-service')
    ;({ createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service'))
  })
  beforeEach(seed)
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('links entries to the transaction of the same amount, opposite side, within one day', async () => {
    const receipt = await entry('in', '120.00', '2025-03-10')
    const payment = await entry('out', '45.50', '2025-03-31')
    const credit = await transaction('120.00', 'credit', '2025-03-11')
    const debit = await transaction('45.50', 'debit', '2025-04-01')
    const wrongSide = await transaction('120.00', 'debit', '2025-03-10')
    const oneCentOff = await transaction('45.51', 'debit', '2025-03-31')

    const result = await svc.autoReconcile({ companyId: ids.company })

    expect(result).toEqual({
      success: true,
      matched: 2,
      reconciledCount: 2,
      total: 2,
      unreconciledOrphanedCount: 0,
      message: '2 transactions rapprochées sur 2 écritures analysées',
    })
    expect(await reconciledWith(credit)).toBe(receipt)
    expect(await reconciledWith(debit)).toBe(payment)
    expect(await reconciledWith(wrongSide)).toBeNull()
    expect(await reconciledWith(oneCentOff)).toBeNull()
    const claimed = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: credit } })
    expect([claimed.reconciled, claimed.reconciledAt instanceof Date]).toEqual([true, true])

    // A second run links nothing twice
    expect(await svc.autoReconcile({ companyId: ids.company })).toMatchObject({ matched: 0, total: 0, message: '0 transaction rapprochée sur 0 écriture analysée' })
  })

  it('does not match a transaction two days away, nor entries of another journal', async () => {
    await entry('in', '80.00', '2025-05-10')
    await entry('in', '90.00', '2025-05-10', ids.od)
    const far = await transaction('80.00', 'credit', '2025-05-12')
    const otherJournal = await transaction('90.00', 'credit', '2025-05-10')

    const result = await svc.autoReconcile({ companyId: ids.company })

    expect(result).toMatchObject({ matched: 0, total: 1, message: '0 transaction rapprochée sur 1 écriture analysée' })
    expect(await reconciledWith(far)).toBeNull()
    expect(await reconciledWith(otherJournal)).toBeNull()
  })

  it('reconciles one transaction per entry when two transactions match', async () => {
    const receipt = await entry('in', '30.00', '2025-06-01')
    const first = await transaction('30.00', 'credit', '2025-06-01')
    const second = await transaction('30.00', 'credit', '2025-06-02')

    expect((await svc.autoReconcile({ companyId: ids.company })).matched).toBe(1)
    const links = [await reconciledWith(first), await reconciledWith(second)]
    expect(links.filter((l) => l === receipt)).toHaveLength(1)
    expect(links.filter((l) => l === null)).toHaveLength(1)
  })

  it('limits the run to the period when both bounds are given', async () => {
    await entry('in', '10.00', '2025-01-15')
    await entry('in', '20.00', '2025-02-15')
    const january = await transaction('10.00', 'credit', '2025-01-15')
    const february = await transaction('20.00', 'credit', '2025-02-15')

    const result = await svc.autoReconcile({ companyId: ids.company, startDate: '2025-02-01T00:00:00.000Z', endDate: '2025-02-28T23:59:59.999Z' })

    expect(result).toMatchObject({ matched: 1, total: 1 })
    expect(await reconciledWith(january)).toBeNull()
    expect(await reconciledWith(february)).not.toBeNull()
  })

  it('releases transactions whose entry no longer exists', async () => {
    const orphan = await transaction('15.00', 'credit', '2025-07-01', { reconciled: true, reconciledAt: day('2025-07-02'), reconciledWith: 'deleted-entry' })

    const result = await svc.autoReconcile({ companyId: ids.company })

    expect(result).toMatchObject({ unreconciledOrphanedCount: 1, message: '1 transaction dé-rapprochée (écriture supprimée). 0 transaction rapprochée sur 0 écriture analysée' })
    const released = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: orphan } })
    expect([released.reconciled, released.reconciledAt, released.reconciledWith]).toEqual([false, null, null])
  })

  it('reports released transactions when the company has no BQ journal', async () => {
    await prisma.journal.delete({ where: { id: ids.bq } })
    await transaction('15.00', 'credit', '2025-07-01', { reconciled: true, reconciledWith: 'deleted-entry' })

    expect(await svc.autoReconcile({ companyId: ids.company })).toEqual({
      success: true,
      matched: 0,
      reconciledCount: 0,
      total: 0,
      unreconciledOrphanedCount: 1,
      message: '1 transaction dé-rapprochée (écriture supprimée). Aucun journal BQ.',
    })
  })

  it('says in French that there is no BQ journal', async () => {
    // Regression: the API answered the English "No BQ journal found"
    await prisma.journal.delete({ where: { id: ids.bq } })

    expect(await svc.autoReconcile({ companyId: ids.company })).toMatchObject({
      matched: 0,
      unreconciledOrphanedCount: 0,
      message: 'Aucun journal BQ : aucune écriture bancaire à rapprocher.',
    })
  })

  describe('reconcileBankEntries', () => {
    it('never overwrites a transaction reconciled meanwhile (conditional claim)', async () => {
      const txId = await transaction('60.00', 'credit', '2025-08-01')
      const entries = [{ id: 'entry-y', date: day('2025-07-31'), lines: [{ accountCode: '512000', debit: '60.00', credit: '0' }] }]
      // Reconciled by someone else after the candidates were read
      const findMany = prisma.bankTransaction.findMany.bind(prisma.bankTransaction)
      const spy = vi.spyOn(prisma.bankTransaction, 'findMany').mockImplementationOnce((async (args: Parameters<typeof findMany>[0]) => {
        const rows = await findMany(args)
        await prisma.bankTransaction.update({ where: { id: txId }, data: { reconciled: true, reconciledWith: 'other-entry' } })
        return rows
      }) as never)
      try {
        expect(await svc.reconcileBankEntries(ids.company, entries)).toEqual({ matched: 0, failed: 0 })
      } finally {
        spy.mockRestore()
      }
      expect(await reconciledWith(txId)).toBe('other-entry')
    })

    it('only reads transactions of the company', async () => {
      const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
      const connection = await prisma.bankConnection.create({ data: { companyId: other.id, provider: 'MANUAL' } })
      const foreignAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'foreign', name: 'Autre' } })
      const foreign = await transaction('60.00', 'credit', '2025-08-01', { bankAccountId: foreignAccount.id })
      const entries = [{ id: 'entry-z', date: day('2025-08-01'), lines: [{ accountCode: '512000', debit: '60.00', credit: '0' }] }]

      expect(await svc.reconcileBankEntries(ids.company, entries)).toEqual({ matched: 0, failed: 0 })
      expect(await reconciledWith(foreign)).toBeNull()
    })
  })

  it('reports a failure instead of "0 transaction rapprochée" (KLEDG-R3-QUAL-18)', async () => {
    await entry('in', '25.00', '2025-09-01')
    await transaction('25.00', 'credit', '2025-09-01')
    const findMany = prisma.bankTransaction.findMany.bind(prisma.bankTransaction)
    let calls = 0
    // The second read is the candidate transactions of the chunk
    const spy = vi.spyOn(prisma.bankTransaction, 'findMany').mockImplementation((async (args: Parameters<typeof findMany>[0]) => {
      calls += 1
      if (calls === 2) throw new Error('connection reset')
      return findMany(args)
    }) as never)
    try {
      const result = await svc.autoReconcile({ companyId: ids.company })
      expect(result).toMatchObject({ success: false, matched: 0, total: 1 })
      expect(result.message).toBe('0 transaction rapprochée sur 1 écriture analysée (1 écriture non traitée après une erreur, réessayez)')
    } finally {
      spy.mockRestore()
    }
  })

  it('FEC import: two identical transactions and one bank line reconcile exactly one (KLEDG-R3-QUAL-04)', async () => {
    const first = await transaction('50.00', 'debit', '2025-03-01')
    const second = await transaction('50.00', 'debit', '2025-03-02')
    const fec = [
      'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise',
      'BQ|Banque|1|20250301|606100|Fournitures|||CB1|20250301|Carte fournitures|50,00|0,00|||20250302||',
      'BQ|Banque|1|20250301|512000|Banque|||CB1|20250301|Carte fournitures|0,00|50,00|||20250302||',
    ].join('\n')
    const { importFEC } = await import('@/lib/import/fec')
    const result = await importFEC({ companyId: ids.company, content: fec })
    expect(result.errors).toEqual([])
    const imported = await prisma.accountingEntry.findFirstOrThrow({ where: { companyId: ids.company, description: 'Carte fournitures' }, select: { id: true } })
    const links = [await reconciledWith(first), await reconciledWith(second)]
    expect(links).toEqual([imported.id, null])
  })

  describe('AutoReconcileBodySchema', () => {
    it('accepts an empty body or two dates and refuses an unreadable date in French', () => {
      expect(svc.AutoReconcileBodySchema.parse(undefined)).toEqual({})
      expect(svc.AutoReconcileBodySchema.parse({ startDate: '2025-01-01', endDate: '2025-01-31' })).toEqual({ startDate: '2025-01-01', endDate: '2025-01-31' })
      const refused = svc.AutoReconcileBodySchema.safeParse({ startDate: 'hier' })
      expect(refused.success).toBe(false)
      expect(refused.error?.issues[0]?.message).toBe('Date invalide')
    })
  })
})
