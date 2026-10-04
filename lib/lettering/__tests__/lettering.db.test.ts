/**
 * Lettering against PostgreSQL (skipped without the server): balanced
 * groups only, one code sequence per account, validated entries lettered
 * through the immutability triggers, unlettering, closed fiscal years,
 * concurrent letterings under the account lock, automatic lettering from
 * reconciled payments, and the FEC round trip of EcritureLet and DateLet
 * (LPF art. A47 A-1).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('lettering')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { bookLedger, type Ledger } from './helpers/ledger'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let lettering: typeof import('../lettering.service')
let errors: typeof import('@/lib/accounting/errors')

/** 23:30 UTC on 15 March is 00:30 on 16 March in Paris: the lettering day is the French one. */
const NOW = new Date('2026-03-15T23:30:00Z')

async function codesOf(lineIds: string[]) {
  const rows = await prisma.entryLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, letteringCode: true, letteringDate: true } })
  return Object.fromEntries(rows.map((r) => [r.id, { code: r.letteringCode, date: r.letteringDate?.toISOString().slice(0, 10) ?? null }]))
}

/** An invoice and its payment for one customer. */
async function invoiceAndPayment(ledger: Ledger, aux: [string, string], amount: string, day: number) {
  const date = `2026-02-${String(day).padStart(2, '0')}`
  const sale = await ledger.entry('VE', date, `Facture ${aux[1]}`, [
    { code: '411000', debit: amount, aux },
    { code: '706000', credit: amount },
  ])
  const payment = await ledger.entry('BQ', `2026-03-${String(day).padStart(2, '0')}`, `Règlement ${aux[1]}`, [
    { code: '512000', debit: amount },
    { code: '411000', credit: amount, aux },
  ])
  return { sale, payment, ids: [sale.line('411000'), payment.line('411000')] }
}

describe.skipIf(!available)('lettering (PostgreSQL)', () => {
  let ledger: Ledger

  beforeAll(async () => {
    await prepareTestDatabase('lettering')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    lettering = await import('../lettering.service')
    errors = await import('@/lib/accounting/errors')
  })
  beforeEach(async () => {
    await prepareTestDatabase('lettering')
    ledger = await bookLedger(prisma, svc, { siren: '900000001', slug: 'lettrage-alpha' })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('letters a balanced group of validated lines with AA, then AB, dated the French day', async () => {
    const first = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '1200.00', 3)
    const second = await invoiceAndPayment(ledger, ['C002', 'Café des Arts'], '80.50', 4)

    const a = await lettering.letterLines(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: first.ids }, { now: NOW })
    expect(a).toEqual({ code: 'AA', letteringDate: '2026-03-16', lineIds: first.ids, amountCents: 120_000 })
    const b = await lettering.letterLines(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: second.ids }, { now: NOW })
    expect(b.code).toBe('AB')

    const stored = await codesOf([...first.ids, ...second.ids])
    expect(Object.values(stored).map((s) => s.code)).toEqual(expect.arrayContaining(['AA', 'AA', 'AB', 'AB']))
    expect(stored[first.ids[0]]).toEqual({ code: 'AA', date: '2026-03-16' })

    // The entries stay validated and unchanged: only the lettering fields moved
    const entry = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: first.sale.id }, include: { lines: true } })
    expect(entry.status).toBe('validated')
    expect(entry.lines.map((l) => l.debit.toString()).sort()).toEqual(['0', '1200'])

    const audit = await prisma.auditLog.findMany({ where: { action: 'LETTER_ENTRY_LINES', companyId: ledger.companyId } })
    expect(audit).toHaveLength(2)
  })

  it('refuses an unbalanced selection (no partial lettering) and writes nothing', async () => {
    const sale = await ledger.entry('VE', '2026-02-01', 'Facture', [{ code: '411000', debit: '1000.00', aux: ['C001', 'Martin SA'] }, { code: '706000', credit: '1000.00' }])
    const partial = await ledger.entry('BQ', '2026-02-15', 'Acompte', [{ code: '512000', debit: '400.00' }, { code: '411000', credit: '400.00', aux: ['C001', 'Martin SA'] }])
    const ids = [sale.line('411000'), partial.line('411000')]
    const attempt = lettering.letterLines(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: ids }, { now: NOW })
    await expect(attempt).rejects.toBeInstanceOf(errors.ValidationError)
    await expect(attempt).rejects.toThrow(/écart de 600,00 €/)
    expect(Object.values(await codesOf(ids)).every((s) => s.code === null)).toBe(true)

    // The balance comes with the rest of the payment: three lines, one code
    const rest = await ledger.entry('BQ', '2026-03-01', 'Solde', [{ code: '512000', debit: '600.00' }, { code: '411000', credit: '600.00' }])
    const group = await lettering.letterLines(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: [...ids, rest.line('411000')] }, { now: NOW })
    expect(group).toMatchObject({ code: 'AA', amountCents: 100_000 })
  })

  it('refuses drafts, lines of another account or company, and accounts that are not lettered', async () => {
    const validated = await ledger.entry('VE', '2026-02-01', 'Facture', [{ code: '411000', debit: '50.00' }, { code: '706000', credit: '50.00' }])
    const draft = await ledger.entry('BQ', '2026-02-02', 'Règlement', [{ code: '512000', debit: '50.00' }, { code: '411000', credit: '50.00' }], 'draft')
    const accountId = ledger.accounts['411000']
    await expect(lettering.letterLines(ledger.companyId, { accountId, lineIds: [validated.line('411000'), draft.line('411000')] })).rejects.toThrow(
      /brouillon\u00a0: validez l'écriture/,
    )
    await expect(lettering.letterLines(ledger.companyId, { accountId, lineIds: [validated.line('411000'), validated.line('706000')] })).rejects.toBeInstanceOf(
      errors.NotFoundError,
    )
    await expect(lettering.letterLines(ledger.companyId, { accountId: ledger.accounts['512000'], lineIds: [draft.line('512000')] })).rejects.toBeInstanceOf(
      errors.ConflictError,
    )
    const other = await bookLedger(prisma, svc, { siren: '900000002', slug: 'lettrage-beta' })
    await expect(lettering.letterLines(other.companyId, { accountId, lineIds: [validated.line('411000')] })).rejects.toBeInstanceOf(errors.NotFoundError)
    await expect(lettering.listLetteringLines(other.companyId, { accountId, status: 'open' })).rejects.toBeInstanceOf(errors.NotFoundError)
  })

  it('unletters a code, which the sequence reuses only when it was the last one', async () => {
    const first = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '10.00', 3)
    const second = await invoiceAndPayment(ledger, ['C002', 'Éole'], '20.00', 4)
    const accountId = ledger.accounts['411000']
    await lettering.letterLines(ledger.companyId, { accountId, lineIds: first.ids }, { now: NOW })
    await lettering.letterLines(ledger.companyId, { accountId, lineIds: second.ids }, { now: NOW })

    expect(await lettering.unletterCode(ledger.companyId, { accountId, code: 'AA' })).toEqual({ code: 'AA', lineCount: 2 })
    expect(Object.values(await codesOf(first.ids))).toEqual([{ code: null, date: null }, { code: null, date: null }])
    expect((await lettering.listLetteringLines(ledger.companyId, { accountId, status: 'open' })).nextCode).toBe('AC')

    await lettering.unletterCode(ledger.companyId, { accountId, code: 'AB' })
    expect((await lettering.listLetteringLines(ledger.companyId, { accountId, status: 'open' })).nextCode).toBe('AA')
    await expect(lettering.unletterCode(ledger.companyId, { accountId, code: 'ZZ' })).rejects.toBeInstanceOf(errors.NotFoundError)
  })

  it('lists the lines of an account with a running balance, reconciliation flags and drafts aside', async () => {
    const { payment } = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '300.00', 5)
    await ledger.entry('VE', '2026-04-01', 'Facture 2', [{ code: '411000', debit: '45.00', aux: ['C002', 'Éole'] }, { code: '706000', credit: '45.00' }])
    await ledger.entry('VE', '2026-04-02', 'Brouillon', [{ code: '411000', debit: '1.00' }, { code: '706000', credit: '1.00' }], 'draft')
    const connection = await prisma.bankConnection.create({ data: { companyId: ledger.companyId, login: 'l', secretKeyEncrypted: 'x' } })
    const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'ext', name: 'Compte' } })
    await prisma.bankTransaction.create({
      data: { bankAccountId: bankAccount.id, externalTransactionId: 't1', amount: 300, date: new Date('2026-03-05T00:00:00Z'), side: 'credit', reconciled: true, reconciledWith: payment.id },
    })

    const result = await lettering.listLetteringLines(ledger.companyId, { accountId: ledger.accounts['411000'], status: 'open' })
    expect(result.lines.map((l) => [l.date, l.debitCents, l.creditCents, l.runningBalanceCents, l.reconciled])).toEqual([
      ['2026-02-05', 30_000, 0, 30_000, false],
      ['2026-03-05', 0, 30_000, 0, true],
      ['2026-04-01', 4_500, 0, 4_500, false],
    ])
    expect(result).toMatchObject({ draftCount: 1, truncated: false, nextCode: 'AA', totals: { balanceCents: 4_500 } })

    const accounts = await lettering.listLetterableAccounts(ledger.companyId, ledger.fiscalYearId)
    expect(accounts.accounts.map((a) => [a.code, a.openCount, a.openBalanceCents])).toEqual([['411000', 3, 4_500]])
  })

  it('proposes and applies automatic lettering, payments confirmed by the bank first', async () => {
    const martin = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '120.00', 6)
    const sale = await ledger.entry('VE', '2026-02-07', 'Facture Éole', [{ code: '411000', debit: '75.25', aux: ['C002', 'Éole'] }, { code: '706000', credit: '75.25' }])
    // Booked at reconciliation on the collective account, without auxiliary account
    const bank = await ledger.entry('BQ', '2026-03-07', 'Virement Éole', [{ code: '512000', debit: '75.25' }, { code: '411000', credit: '75.25' }])
    const connection = await prisma.bankConnection.create({ data: { companyId: ledger.companyId, login: 'l', secretKeyEncrypted: 'x' } })
    const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'ext', name: 'Compte' } })
    await prisma.bankTransaction.create({
      data: { bankAccountId: bankAccount.id, externalTransactionId: 't2', amount: 75.25, date: new Date('2026-03-07T00:00:00Z'), side: 'credit', reconciled: true, reconciledWith: bank.id },
    })

    const accountId = ledger.accounts['411000']
    const { suggestions } = await lettering.getLetteringSuggestions(ledger.companyId, accountId)
    expect(suggestions).toEqual([
      { lineIds: [sale.line('411000'), bank.line('411000')], amountCents: 7_525, auxiliaryAccountNumber: 'C002', reason: 'same-amount', fromReconciliation: true },
      { lineIds: martin.ids, amountCents: 12_000, auxiliaryAccountNumber: 'C001', reason: 'same-third-party', fromReconciliation: false },
    ])

    const applied = await lettering.autoLetterAccount(ledger.companyId, accountId, { now: NOW })
    expect(applied.groups.map((g) => g.code)).toEqual(['AA', 'AB'])
    expect(applied.message).toBe('2 lettrages effectués\u00a0: AA, AB.')
    expect((await lettering.getLetteringSuggestions(ledger.companyId, accountId)).suggestions).toEqual([])
    expect((await lettering.autoLetterAccount(ledger.companyId, accountId)).message).toBe('Aucune proposition de lettrage sur ce compte.')
  })

  it('previews a lettering without writing it', async () => {
    const { ids } = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '10.00', 8)
    const preview = await lettering.previewLettering(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: ids })
    expect(preview).toMatchObject({ code: 'AA', debitCents: 1_000, creditCents: 1_000, problems: [] })
    expect(Object.values(await codesOf(ids)).every((s) => s.code === null)).toBe(true)
    const bad = await lettering.previewLettering(ledger.companyId, { accountId: ledger.accounts['411000'], lineIds: [ids[0]] })
    expect(bad.problems.join(' ')).toMatch(/au moins deux lignes/)
  })

  describe('closed fiscal year', () => {
    it('refuses lettering and unlettering in a closed year, although the triggers would allow it', async () => {
      const lettered = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '10.00', 9)
      const open = await invoiceAndPayment(ledger, ['C002', 'Éole'], '20.00', 10)
      const accountId = ledger.accounts['411000']
      await lettering.letterLines(ledger.companyId, { accountId, lineIds: lettered.ids }, { now: NOW })
      await prisma.fiscalYear.update({ where: { id: ledger.fiscalYearId }, data: { isClosed: true, closedAt: new Date() } })

      await expect(lettering.letterLines(ledger.companyId, { accountId, lineIds: open.ids })).rejects.toThrow(/L'exercice 2026 est clôturé/)
      await expect(lettering.unletterCode(ledger.companyId, { accountId, code: 'AA' })).rejects.toBeInstanceOf(errors.ConflictError)
      await expect(lettering.autoLetterAccount(ledger.companyId, accountId)).rejects.toBeInstanceOf(errors.ConflictError)
      expect((await codesOf(lettered.ids))[lettered.ids[0]].code).toBe('AA')

      // The database triggers keep lettering outside the closed year lock
      // (migration 20261004100000): the refusal above is Kledg's choice.
      await prisma.entryLine.update({ where: { id: open.ids[0] }, data: { letteringCode: 'ZZ' } })
      await prisma.entryLine.update({ where: { id: open.ids[0] }, data: { letteringCode: null } })
      // Accounting content stays locked
      await expect(prisma.entryLine.update({ where: { id: open.ids[0] }, data: { debit: 1 } })).rejects.toThrow()
    })
  })

  describe('concurrency', () => {
    it('letters the same lines once when two requests race: one code, one 409', async () => {
      const { ids } = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '99.99', 11)
      const accountId = ledger.accounts['411000']
      const results = await Promise.allSettled([
        lettering.letterLines(ledger.companyId, { accountId, lineIds: ids }, { now: NOW }),
        lettering.letterLines(ledger.companyId, { accountId, lineIds: [...ids].reverse() }, { now: NOW }),
      ])
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toBeInstanceOf(errors.ConflictError)
      expect(new Set(Object.values(await codesOf(ids)).map((s) => s.code))).toEqual(new Set(['AA']))
    })

    it('gives two groups lettered at the same time two different codes', async () => {
      const groups = await Promise.all(
        [12, 13, 14, 15].map((day, i) => invoiceAndPayment(ledger, [`C00${i}`, `Client ${i}`], `${day}.00`, day)),
      )
      const accountId = ledger.accounts['411000']
      const lettered = await Promise.all(groups.map((g) => lettering.letterLines(ledger.companyId, { accountId, lineIds: g.ids }, { now: NOW })))
      expect(lettered.map((g) => g.code).sort()).toEqual(['AA', 'AB', 'AC', 'AD'])
    })
  })

  describe('FEC round trip', () => {
    it('exports EcritureLet and DateLet and imports them back, the sequence continuing after the import', async () => {
      const fecExport = await import('@/lib/fec/export')
      const fecImport = await import('@/lib/import/fec')
      const validator = await import('@/lib/fec/validator')
      const first = await invoiceAndPayment(ledger, ['C001', 'Martin SA'], '1440.00', 16)
      const second = await invoiceAndPayment(ledger, ['C002', 'Éole'], '12.34', 17)
      await invoiceAndPayment(ledger, ['C003', 'Ouvert'], '5.00', 18)
      const accountId = ledger.accounts['411000']
      await lettering.letterLines(ledger.companyId, { accountId, lineIds: first.ids }, { now: NOW })
      await lettering.letterLines(ledger.companyId, { accountId, lineIds: second.ids }, { now: new Date('2026-04-02T10:00:00Z') })

      const exported = await fecExport.exportFec(ledger.companyId, ledger.fiscalYearId)
      const report = validator.validateFec(exported.content)
      expect(report.errors).toEqual([])
      expect(report.warnings).toEqual([])
      const records = exported.content.split('\r\n').slice(1).filter(Boolean).map((row) => row.split('\t'))
      const lettered = records.filter((r) => r[4] === '411000').map((r) => [r[6], r[13], r[14]])
      expect(lettered).toEqual(
        expect.arrayContaining([
          ['C001', 'AA', '20260316'],
          ['C001', 'AA', '20260316'],
          ['C002', 'AB', '20260402'],
          ['C002', 'AB', '20260402'],
          ['C003', '', ''],
          ['C003', '', ''],
        ]),
      )

      const target = await prisma.company.create({ data: { name: 'cible', slug: 'cible', siren: '900000003' } })
      const result = await fecImport.importFEC({ companyId: target.id, bytes: new TextEncoder().encode(exported.content) })
      expect(result.errors).toEqual([])
      const imported = await prisma.entryLine.findMany({
        where: { accountingEntry: { companyId: target.id }, account: { code: '411000' } },
        select: { auxiliaryAccountNumber: true, letteringCode: true, letteringDate: true, accountId: true },
      })
      const byCode = (code: string | null) => imported.filter((l) => l.letteringCode === code)
      expect(byCode('AA').map((l) => [l.auxiliaryAccountNumber, l.letteringDate?.toISOString().slice(0, 10)])).toEqual([
        ['C001', '2026-03-16'],
        ['C001', '2026-03-16'],
      ])
      expect(byCode('AB')).toHaveLength(2)
      expect(byCode(null)).toHaveLength(2)

      // The same file again from the imported company
      const targetYear = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: target.id } })
      expect((await fecExport.exportFec(target.id, targetYear.id)).content).toBe(exported.content)

      // Lettering goes on in the imported books: the next code is AC
      const open = await lettering.listLetteringLines(target.id, { accountId: imported[0].accountId, status: 'open' })
      expect(open.nextCode).toBe('AC')
      const next = await lettering.letterLines(target.id, { accountId: imported[0].accountId, lineIds: open.lines.map((l) => l.id) }, { now: NOW })
      expect(next.code).toBe('AC')
    })
  })
})
