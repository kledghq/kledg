/**
 * Applying a transaction rule against PostgreSQL (lib/transactions/rule-executor.ts,
 * skipped without the test database server): the draft entry written for a
 * bank transaction, line by line in cents, with VAT extracted from the TTC
 * amount (taux normal 20 %, CGI art. 278), self-assessed VAT on intra-EU
 * acquisitions (CGI art. 256 bis, deductible under art. 271), the bank line
 * always equal to the transaction, and the refusals (unknown accounts,
 * journal, closed or missing fiscal year, transaction already reconciled).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_rule_executor')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { toCents } from '@/lib/utils/money'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let executor: typeof import('@/lib/transactions/rule-executor')

const ids = {} as Record<string, string>
let txCounter = 0

const CODES = ['411000', '512000', '606100', '607000', '627000', '706000', '445660', '445662', '445710', '44571', '445200']

async function seed() {
  await prepareTestDatabase('cov_rule_executor')
  txCounter = 0
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
  })
  const closed = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2024, startDate: new Date('2024-01-01T00:00:00Z'), endDate: new Date('2024-12-31T00:00:00Z') },
  })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  for (const code of CODES) {
    const account = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label: code } })
    ids[code] = account.id
  }
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: 'login', secretKeyEncrypted: 'encrypted' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'ext', name: 'Compte courant' } })
  // Closing happens after the accounts exist: the closed year lock refuses writes afterwards
  await prisma.fiscalYear.update({ where: { id: closed.id }, data: { isClosed: true, closedAt: new Date('2025-03-01T00:00:00Z') } })
  Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bankAccount: bankAccount.id })
}

async function transaction(amount: string, side: 'debit' | 'credit', extra: Record<string, unknown> = {}) {
  txCounter += 1
  const tx = await prisma.bankTransaction.create({
    data: {
      bankAccountId: ids.bankAccount,
      externalTransactionId: `tx-${txCounter}`,
      amount,
      side,
      date: new Date('2025-03-15T00:00:00Z'),
      label: 'CB PAPETERIE MARTIN',
      reference: 'REF-1',
      ...extra,
    },
  })
  return tx.id
}

type LineInput = {
  accountCode: string
  lineType?: string
  amountType?: string
  amountValue?: string
  vatType?: string
  vatRate?: string
  vatRateSource?: string
  vatAccountCode?: string
  vatAccount2Code?: string
  description?: string
}

async function rule(name: string, lines: LineInput[], extra: Record<string, unknown> = {}) {
  const created = await prisma.transactionRule.create({
    data: {
      companyId: ids.company,
      name,
      journalCode: 'BQ',
      ...extra,
      entryLines: {
        create: lines.map((line, order) => ({ lineType: 'auto', amountType: 'full', order, ...line })),
      },
    },
  })
  return created.id
}

/** Lines of the prepared entry as [account code, debit cents, credit cents]. */
async function prepared(ruleId: string, transactionId: string) {
  const result = await executor.prepareRuleEntry(ruleId, transactionId, ids.company)
  if (!result.ok) return result
  const codeOf = new Map(Object.entries(ids).map(([code, id]) => [id, code]))
  return result.lines.map((l) => [codeOf.get(l.accountId), l.debitCents, l.creditCents])
}

describe.skipIf(!available)('applying transaction rules (PostgreSQL)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_rule_executor')
    ;({ prisma } = await import('@/lib/prisma'))
    executor = await import('@/lib/transactions/rule-executor')
  })
  beforeEach(seed)
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('writes a purchase of 120,00 TTC as 100,00 HT + 20,00 deductible VAT, credited to the bank (CGI art. 278)', async () => {
    const ruleId = await rule('Fournitures', [{ accountCode: '606100', vatType: 'deductible', vatRate: '20', vatAccountCode: '445660' }])
    const txId = await transaction('120.00', 'debit')

    const result = await executor.applyRule(ruleId, txId, ids.company)

    expect(result).toMatchObject({ success: true })
    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: result.entryId! },
      include: { lines: { orderBy: { createdAt: 'asc' }, include: { account: true } } },
    })
    expect([entry.status, entry.journalId, entry.fiscalYearId, entry.date.toISOString(), entry.description, entry.reference]).toEqual([
      'draft',
      ids.journal,
      ids.fy,
      '2025-03-15T00:00:00.000Z',
      'CB PAPETERIE MARTIN',
      'REF-1',
    ])
    expect(entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2), l.description])).toEqual([
      ['606100', '100.00', '0.00', 'CB PAPETERIE MARTIN'],
      ['445660', '20.00', '0.00', 'TVA déductible 20 %'],
      ['512000', '0.00', '120.00', 'CB PAPETERIE MARTIN'],
    ])
    const tx = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: txId } })
    expect([tx.reconciled, tx.reconciledWith]).toEqual([true, entry.id])
    const updated = await prisma.transactionRule.findUniqueOrThrow({ where: { id: ruleId } })
    expect(updated.usageCount).toBe(1)
    expect(updated.lastUsedAt).toBeInstanceOf(Date)

    // Applied twice: one entry only, 409 with the reconciliation message
    expect(await executor.applyRule(ruleId, txId, ids.company)).toEqual({
      success: false,
      error: 'Cette transaction est déjà rapprochée : rechargez la liste pour voir son écriture.',
      status: 409,
    })
    expect(await prisma.accountingEntry.count()).toBe(1)
  })

  it('writes a sale of 100,00 TTC as 83,33 HT + 16,67 collected VAT, debited to the bank', async () => {
    const ruleId = await rule('Ventes', [{ accountCode: '706000', vatType: 'collectible', vatRate: '20', vatAccountCode: '445710' }])
    const txId = await transaction('100.00', 'credit')

    expect(await prepared(ruleId, txId)).toEqual([
      ['706000', 0, 8333],
      ['445710', 0, 1667],
      ['512000', 10000, 0],
    ])
  })

  it('splits a transaction by percentage, fixed amount and remainder, exact to the cent', async () => {
    const ruleId = await rule('Répartition', [
      { accountCode: '606100', amountType: 'percentage', amountValue: '33.33' },
      { accountCode: '607000', amountType: 'fixed', amountValue: '10.00' },
      { accountCode: '627000', amountType: 'remaining' },
    ])
    const txId = await transaction('100.00', 'debit')

    // 33,33 % of 100,00 = 33,33; fixed 10,00; remainder 56,67
    expect(await prepared(ruleId, txId)).toEqual([
      ['606100', 3333, 0],
      ['607000', 1000, 0],
      ['627000', 5667, 0],
      ['512000', 0, 10000],
    ])
  })

  it('self-assesses intra-EU VAT: charge at 100,00, deductible and due VAT of 20,00 each (CGI art. 256 bis)', async () => {
    const ruleId = await rule('Achat UE', [
      { accountCode: '607000', vatType: 'intracom', vatRate: '20', vatAccountCode: '445662', vatAccount2Code: '445200' },
    ])
    const txId = await transaction('100.00', 'debit')

    expect(await prepared(ruleId, txId)).toEqual([
      ['607000', 10000, 0],
      ['445662', 2000, 0],
      ['445200', 0, 2000],
      ['512000', 0, 10000],
    ])
  })

  it('uses the VAT amount detected by the bank when the line takes VAT from the transaction', async () => {
    const ruleId = await rule('Restaurant', [{ accountCode: '627000', vatType: 'deductible', vatRateSource: 'transaction', vatRate: '20', vatAccountCode: '445660' }])
    const fromColumns = await transaction('22.00', 'debit', { vatAmount: '2.00', vatRate: '10' })
    const fromProvider = await transaction('11.00', 'debit', { providerData: { vat_amount_cents: 100 } })

    expect(await prepared(ruleId, fromColumns)).toEqual([
      ['627000', 2000, 0],
      ['445660', 200, 0],
      ['512000', 0, 2200],
    ])
    expect(await prepared(ruleId, fromProvider)).toEqual([
      ['627000', 1000, 0],
      ['445660', 100, 0],
      ['512000', 0, 1100],
    ])
  })

  it('uses the rule bank account (51x) rather than the company default', async () => {
    const other = await prisma.account.create({ data: { companyId: ids.company, fiscalYearId: ids.fy, code: '512100', label: 'Banque 2' } })
    ids['512100'] = other.id
    const ruleId = await rule('Virement interne', [
      { accountCode: '627000' },
      { accountCode: '512100', lineType: 'credit', amountType: 'full' },
    ])
    const txId = await transaction('5.00', 'debit')

    expect(await prepared(ruleId, txId)).toEqual([
      ['627000', 500, 0],
      ['512100', 0, 500],
    ])
  })

  it('writes a one cent transaction with its bank line', async () => {
    // Regression: an imbalance of exactly 0,01 got no bank line and the rule was refused
    const ruleId = await rule('Frais', [{ accountCode: '627000' }])
    const txId = await transaction('0.01', 'debit')

    expect(await prepared(ruleId, txId)).toEqual([
      ['627000', 1, 0],
      ['512000', 0, 1],
    ])
  })

  describe('partly exempt company (coefficient de déduction, CGI ann. II art. 206)', () => {
    // Regression: the VAT the company could not recover disappeared, so the
    // entry of a 120,00 purchase credited the bank with 100,00 or 112,00.
    const purchaseRule = () => rule('Fournitures', [{ accountCode: '606100', vatType: 'deductible', vatRate: '20', vatAccountCode: '445660' }])

    it('charges the whole TTC amount when no VAT is recoverable', async () => {
      await prisma.company.update({ where: { id: ids.company }, data: { isVatExempt: true } })
      const ruleId = await purchaseRule()
      const txId = await transaction('120.00', 'debit')

      expect(await prepared(ruleId, txId)).toEqual([
        ['606100', 12000, 0],
        ['512000', 0, 12000],
      ])
      // The rule editor's preview shows the same expense
      const { simulateRuleFromData } = await import('@/lib/transactions/rule-simulator')
      const preview = await simulateRuleFromData(
        { entryLines: [{ accountCode: '606100', lineType: 'auto', amountType: 'full', order: 0, vatType: 'deductible', vatRate: 20, vatAccountCode: '445660' }] },
        { amount: -120, side: 'debit', label: 'CB' },
        ids.company,
      )
      expect(preview.entryLines.map((l) => [l.account.code, toCents(l.debit), toCents(l.credit)])).toEqual([['606100', 12000, 0]])
    })

    it('recovers 60 % of the VAT and charges the rest with the expense', async () => {
      await prisma.company.update({ where: { id: ids.company }, data: { isVatExempt: true } })
      // March 2025 revenue: 600,00 with VAT, 400,00 exempt, ratio 0,6
      const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
      const sale = (lines: Array<{ accountId: string; debit: string | number; credit: string | number }>) =>
        createEntry({ companyId: ids.company, journalId: ids.journal, date: '2025-03-01', description: 'Ventes', status: 'validated', lines })
      await sale([
        { accountId: ids['411000'], debit: '720.00', credit: 0 },
        { accountId: ids['706000'], debit: 0, credit: '600.00' },
        { accountId: ids['44571'], debit: 0, credit: '120.00' },
      ])
      await sale([
        { accountId: ids['411000'], debit: '400.00', credit: 0 },
        { accountId: ids['706000'], debit: 0, credit: '400.00' },
      ])
      const ruleId = await purchaseRule()
      const txId = await transaction('120.00', 'debit')

      // VAT 20,00: 12,00 recovered, 8,00 added to the 100,00 HT expense
      expect(await prepared(ruleId, txId)).toEqual([
        ['606100', 10800, 0],
        ['445660', 1200, 0],
        ['512000', 0, 12000],
      ])

      // Self-assessed VAT (R3): due in full on 4452, deducted at the coefficient, the rest in the charge.
      // 100,00 of intra-EU goods at 20 %, coefficient 60 %: 20,00 due, 12,00 deducted, charge 108,00
      const intracom = await rule('Achat UE', [{ accountCode: '607000', vatType: 'intracom', vatRate: '20', vatAccountCode: '445662', vatAccount2Code: '445200' }])
      const euTx = await transaction('100.00', 'debit')
      expect(await prepared(intracom, euTx)).toEqual([
        ['607000', 10800, 0],
        ['445662', 1200, 0],
        ['445200', 0, 2000],
        ['512000', 0, 10000],
      ])
      // The rule editor's preview books the same lines
      const { simulateRuleFromData } = await import('@/lib/transactions/rule-simulator')
      const preview = await simulateRuleFromData(
        { entryLines: [{ accountCode: '607000', lineType: 'auto', amountType: 'full', order: 0, vatType: 'intracom', vatRate: 20, vatAccountCode: '445662', vatAccount2Code: '445200' }] },
        { amount: -100, side: 'debit', label: 'CB' },
        ids.company,
      )
      expect(preview.entryLines.map((l) => [l.account.code, toCents(l.debit), toCents(l.credit)])).toEqual([
        ['607000', 10800, 0],
        ['445662', 1200, 0],
        ['445200', 0, 2000],
      ])
    })
  })

  describe('refusals', () => {
    it('names the account codes missing from the fiscal year', async () => {
      const ruleId = await rule('Inconnu', [{ accountCode: '999999' }, { accountCode: '606100', vatType: 'deductible', vatRate: '20', vatAccountCode: '445999' }])
      const txId = await transaction('10.00', 'debit')

      expect(await executor.prepareRuleEntry(ruleId, txId, ids.company)).toEqual({
        ok: false,
        error: "Certains comptes de la règle n'existent pas dans l'exercice 2025 : 999999, 445999",
        status: 400,
      })
    })

    it('refuses a rule without lines, a missing journal and an unknown rule', async () => {
      const txId = await transaction('10.00', 'debit')
      const empty = await prisma.transactionRule.create({ data: { companyId: ids.company, name: 'Vide' } })
      const noJournal = await rule('Journal absent', [{ accountCode: '606100' }], { journalCode: 'XX' })

      expect(await executor.prepareRuleEntry(empty.id, txId, ids.company)).toEqual({
        ok: false,
        error: "La règle « Vide » ne contient aucune ligne d'écriture.",
        status: 400,
      })
      expect(await executor.prepareRuleEntry(noJournal, txId, ids.company)).toMatchObject({ ok: false, error: 'Journal XX introuvable.' })
      expect(await executor.prepareRuleEntry('missing', txId, ids.company)).toEqual({ ok: false, error: 'Règle introuvable', status: 404 })
      expect(await executor.prepareRuleEntry(noJournal, 'missing', ids.company)).toEqual({ ok: false, error: 'Transaction introuvable', status: 404 })
    })

    it('says in French which line lacks its VAT account', async () => {
      // Regression: the English "VAT account not defined for line <id>" reached the user
      const ruleId = await rule('Sans compte TVA', [{ accountCode: '627000', amountType: 'fixed', amountValue: '1.00' }, { accountCode: '606100', amountType: 'remaining', vatType: 'deductible', vatRate: '20' }])
      const txId = await transaction('120.00', 'debit')

      expect(await executor.prepareRuleEntry(ruleId, txId, ids.company)).toEqual({
        ok: false,
        error: 'La règle « Sans compte TVA » ne peut pas être appliquée : aucun compte de TVA pour la ligne 2 : choisissez-le dans la règle.',
        status: 400,
      })
    })

    it('refuses a transaction dated in a closed fiscal year or outside every fiscal year', async () => {
      const ruleId = await rule('Fournitures', [{ accountCode: '606100' }])
      const inClosed = await transaction('10.00', 'debit', { date: new Date('2024-06-01T00:00:00Z') })
      const outside = await transaction('10.00', 'debit', { date: new Date('2023-06-01T00:00:00Z') })

      expect(await executor.prepareRuleEntry(ruleId, inClosed, ids.company)).toMatchObject({
        ok: false,
        error: "L'exercice 2024 est clôturé : choisissez une date dans un exercice ouvert.",
      })
      expect(await executor.prepareRuleEntry(ruleId, outside, ids.company)).toMatchObject({
        ok: false,
        error: "Aucun exercice comptable ne couvre le 01/06/2023 : créez l'exercice avant de rapprocher.",
      })
    })

    it('throws typed errors from applyRuleToTransaction: 404 for a rule of another company, 409 when reconciled', async () => {
      const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
      const foreign = await prisma.transactionRule.create({ data: { companyId: other.id, name: 'Étrangère' } })
      const ruleId = await rule('Fournitures', [{ accountCode: '606100' }])
      const txId = await transaction('10.00', 'debit')

      await expect(executor.applyRuleToTransaction(ids.company, txId, foreign.id)).rejects.toMatchObject({ statusCode: 404, message: 'Règle introuvable' })
      expect(await executor.applyRuleToTransaction(ids.company, txId, ruleId)).toEqual({ entryId: expect.any(String) })
      await expect(executor.applyRuleToTransaction(ids.company, txId, ruleId)).rejects.toMatchObject({ statusCode: 409 })
    })
  })
})
