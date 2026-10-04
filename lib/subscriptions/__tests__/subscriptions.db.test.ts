/**
 * Detected subscriptions against PostgreSQL (skipped without the server):
 * detection from the stored bank lines of the company only (declined lines
 * and other companies left out), the class 6 account of the latest
 * reconciled payment, decisions that survive a price change and are never
 * duplicated, ids of another company refused (budget line, subscription),
 * and the addition to the budget in one transaction with the decision.
 * Fictitious data.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('subscriptions')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let detect: typeof import('../detect-subscriptions.service')
let decide: typeof import('../decide-subscriptions.service')
let budgets: typeof import('@/lib/budgets/manage-budgets.service')

const TODAY = '2026-06-30'

describe.skipIf(!available)('subscriptions (PostgreSQL)', () => {
  let books: Books
  let other: Books
  let bankAccountId: string
  let otherBankAccountId: string
  let seq = 0

  beforeAll(async () => {
    await prepareTestDatabase('subscriptions')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    detect = await import('../detect-subscriptions.service')
    decide = await import('../decide-subscriptions.service')
    budgets = await import('@/lib/budgets/manage-budgets.service')
  })

  async function bankAccount(companyId: string, name: string) {
    // The manual connection of the books (one per company and provider)
    const connection = await prisma.bankConnection.findFirstOrThrow({ where: { companyId, provider: 'MANUAL' } })
    return (await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `sub-${name}`, name } })).id
  }

  beforeEach(async () => {
    await prepareTestDatabase('subscriptions')
    books = await seedBooks(prisma, svc, { siren: '940000301', slug: 'subscriptions-a' })
    other = await seedBooks(prisma, svc, { siren: '940000302', slug: 'subscriptions-b' })
    books.accounts['626000'] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code: '626000', label: 'Frais postaux et de télécommunications' } })).id
    bankAccountId = await bankAccount(books.companyId, 'a')
    otherBankAccountId = await bankAccount(other.companyId, 'b')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  async function line(account: string, date: string, amount: number, counterpartyName: string, options: { side?: 'debit' | 'credit'; status?: string; reconciledWith?: string } = {}) {
    seq += 1
    return prisma.bankTransaction.create({
      data: {
        bankAccountId: account,
        externalTransactionId: `ext-${seq}`,
        date: new Date(`${date}T00:00:00Z`),
        amount,
        side: options.side ?? 'debit',
        label: `PRLV SEPA ${counterpartyName.toUpperCase()} REF ${seq}`,
        counterpartyName,
        status: options.status ?? 'completed',
        reconciledWith: options.reconciledWith ?? null,
      },
    })
  }

  /** Monthly payments of a phone plan in company A, the latest reconciled with a validated entry on 626000. */
  async function phonePlan(amounts = [39.99, 39.99, 39.99, 39.99, 39.99]) {
    const rows = []
    for (const [i, amount] of amounts.entries()) rows.push(await line(bankAccountId, `2026-0${i + 1}-14`, amount, 'Telecom Pro'))
    const entry = await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.BQ,
      date: rows[rows.length - 1].date.toISOString().slice(0, 10),
      description: 'Forfait mobile',
      status: 'validated',
      lines: [
        { accountId: books.accounts['626000'], debit: String(amounts[amounts.length - 1]), credit: '0' },
        { accountId: books.accounts['512000'], debit: '0', credit: String(amounts[amounts.length - 1]) },
      ],
    })
    await prisma.bankTransaction.update({ where: { id: rows[rows.length - 1].id }, data: { reconciled: true, reconciledWith: entry.id } })
    return rows
  }

  it('detects the subscriptions of the company only, without declined lines, with the account of the latest reconciled payment', async () => {
    const rows = await phonePlan()
    // A declined attempt in between must not break the rhythm
    await line(bankAccountId, '2026-03-02', 39.99, 'Telecom Pro', { status: 'declined' })
    // The same counterparty in company B, every month: never mixed with A
    for (const month of ['01', '02', '03', '04']) await line(otherBankAccountId, `2026-${month}-14`, 39.99, 'Telecom Pro')

    const list = await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      id: rows[0].id,
      name: 'Telecom Pro',
      cadence: 'monthly',
      typicalAmountCents: 3_999,
      annualizedCents: 47_988,
      occurrences: 5,
      lastDay: '2026-05-14',
      nextExpectedDay: '2026-06-14',
      status: 'active',
      decision: null,
      suggestedAccountCode: '626000',
      lastTransactionId: rows[4].id,
    })
    expect(list.observedUntil).toBe('2026-05-14')
    expect(list.totals).toEqual({ activeCount: 1, activeAnnualizedCents: 47_988 })

    const forB = await detect.listDetectedSubscriptions(other.companyId, { today: TODAY })
    expect(forB.items.map((s) => s.occurrences)).toEqual([4])
    expect(forB.items[0].transactionIds.some((id) => rows.some((r) => r.id === id))).toBe(false)
  })

  it('keeps salaries, social charges and taxes out of the subscriptions, by the reconciled entry or the label', async () => {
    for (const [code, label] of [['421000', 'Personnel, rémunérations dues'], ['613200', 'Locations immobilières']]) {
      books.accounts[code] = (await prisma.account.create({ data: { companyId: books.companyId, fiscalYearId: books.fiscalYearId, code, label } })).id
    }
    /** Monthly debits of company A, the latest one reconciled with a validated entry debiting `account` (with VAT on rent). */
    async function series(name: string, label: string | null, amount: number, account?: string) {
      const rows = []
      for (const month of ['01', '02', '03', '04']) {
        seq += 1
        rows.push(
          await prisma.bankTransaction.create({
            data: { bankAccountId, externalTransactionId: `kind-${seq}`, date: new Date(`2026-${month}-05T00:00:00Z`), amount, side: 'debit', label, counterpartyName: name },
          }),
        )
      }
      if (account) {
        const vat = account === '613200' ? Math.round(amount * 100 / 6) / 100 : 0
        const entry = await svc.createEntry({
          companyId: books.companyId,
          journalId: books.journals.BQ,
          date: '2026-04-05',
          description: name,
          status: 'validated',
          lines: [
            { accountId: books.accounts[account], debit: String(Math.round((amount - vat) * 100) / 100), credit: '0' },
            ...(vat ? [{ accountId: books.accounts['445660'], debit: String(vat), credit: '0' }] : []),
            { accountId: books.accounts['512000'], debit: '0', credit: String(amount) },
          ],
        })
        await prisma.bankTransaction.update({ where: { id: rows[3].id }, data: { reconciled: true, reconciledWith: entry.id } })
      }
      return rows
    }
    const salary = await series('Président', 'VIR MENSUEL', 3_120, '421000')
    const urssaf = await series('URSSAF', 'PRLV SEPA URSSAF', 2_600)
    // The label mentions taxes, the entry says rent: a subscription
    const rent = await series('SCI Bureaux', 'LOYER ET IMPOTS FONCIERS', 1_200, '613200')

    const list = await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })
    const byId = (id: string) => list.items.find((s) => s.id === id)!
    expect(byId(salary[0].id)).toMatchObject({ kind: 'recurring_charge', chargeReason: 'personnel', classifiedBy: 'ledger', countsAsSubscription: false })
    expect(byId(urssaf[0].id)).toMatchObject({ kind: 'recurring_charge', chargeReason: 'social', classifiedBy: 'label', countsAsSubscription: false })
    expect(byId(rent[0].id)).toMatchObject({ kind: 'subscription', classifiedBy: 'ledger', countsAsSubscription: true, suggestedAccountCode: '613200' })
    // Only the rent counts in the yearly cost
    expect(list.totals).toEqual({ activeCount: 1, activeAnnualizedCents: 1_440_000 })

    // A user may count a recurring charge as a subscription, and take it back
    const counted = await decide.decideSubscription(books.companyId, { subscriptionId: urssaf[0].id, status: 'confirmed' }, { today: TODAY })
    expect(counted).toMatchObject({ kind: 'recurring_charge', countsAsSubscription: true })
    expect((await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })).totals).toEqual({ activeCount: 2, activeAnnualizedCents: 1_440_000 + 3_120_000 })
    await decide.decideSubscription(books.companyId, { subscriptionId: urssaf[0].id, status: 'pending' }, { today: TODAY })
    expect((await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })).totals.activeCount).toBe(1)
  })

  it('keeps a decision through a price increase, and never writes two decisions for one series', async () => {
    const rows = await phonePlan()
    const confirmed = await decide.decideSubscription(books.companyId, { subscriptionId: rows[0].id, status: 'confirmed' }, { today: TODAY })
    expect(confirmed.decision).toMatchObject({ status: 'confirmed', budgetLine: null })
    // Clicked twice: still one decision
    await decide.decideSubscription(books.companyId, { subscriptionId: rows[0].id, status: 'confirmed' }, { today: TODAY })
    expect(await prisma.subscriptionDecision.count({ where: { companyId: books.companyId } })).toBe(1)

    // The plan goes up in June: same series, same decision
    await line(bankAccountId, '2026-06-15', 44.99, 'Telecom Pro')
    const [after] = (await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })).items
    expect(after).toMatchObject({ status: 'price_changed', typicalAmountCents: 4_499, decision: { status: 'confirmed' } })

    const ignored = await decide.decideSubscription(books.companyId, { subscriptionId: rows[0].id, status: 'ignored' }, { today: TODAY })
    expect(ignored.decision?.status).toBe('ignored')
    const stored = await prisma.subscriptionDecision.findMany({ where: { companyId: books.companyId } })
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ counterpartyKey: 'TELECOM PRO', cadence: 'MONTHLY', status: 'IGNORED' })
    expect(stored[0].referenceAmount.toString()).toBe('44.99')
    expect((await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })).totals).toEqual({ activeCount: 0, activeAnnualizedCents: 0 })

    const pending = await decide.decideSubscription(books.companyId, { subscriptionId: rows[0].id, status: 'pending' }, { today: TODAY })
    expect(pending.decision).toBeNull()
    expect(await prisma.subscriptionDecision.count()).toBe(0)
  })

  it("refuses a subscription id that is not a detected subscription of the company (another company's, a one-off payment)", async () => {
    const rows = await phonePlan()
    const oneOff = await line(bankAccountId, '2026-02-20', 850, 'Mobilier Express')
    await expect(decide.decideSubscription(other.companyId, { subscriptionId: rows[0].id, status: 'ignored' }, { today: TODAY })).rejects.toThrow(/Abonnement introuvable/)
    await expect(decide.decideSubscription(books.companyId, { subscriptionId: oneOff.id, status: 'confirmed' }, { today: TODAY })).rejects.toThrow(/Abonnement introuvable/)
    expect(await prisma.subscriptionDecision.count()).toBe(0)
  })

  it('adds a subscription to a charges line of an open budget with its decision, once', async () => {
    const rows = await phonePlan()
    const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'empty' })
    const charges = await budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '626' })
    const produits = await budgets.createBudgetLine(books.companyId, budget.id, { accountPrefix: '706' })

    const added = await decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: charges.id }, { today: TODAY })
    expect(added.decision).toMatchObject({ status: 'confirmed', budgetLine: { id: charges.id, accountPrefix: '626', fiscalYear: 2026 } })
    const detail = await budgets.getBudget(books.companyId, budget.id)
    const line626 = detail.lines.find((l) => l.id === charges.id)!
    expect(line626.recurringItems).toEqual([expect.objectContaining({ label: 'Telecom Pro', amountCents: 3_999, frequency: 'MONTHLY', startMonth: '2026-01', endMonth: null })])
    expect(line626.annualCents).toBe(47_988)

    // Twice: refused, nothing added
    await expect(decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: charges.id }, { today: TODAY })).rejects.toThrow(/a déjà l'élément récurrent/)
    // A produits line, a line of another company: refused, and the decision is not touched
    await expect(decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: produits.id, label: 'Autre' }, { today: TODAY })).rejects.toThrow(/ligne de charges/)
    const otherBudget = await budgets.createBudget(other.companyId, { fiscalYearId: other.fiscalYearId, template: 'posts' })
    const foreignLine = otherBudget.lines.find((l) => l.accountPrefix === '62')!
    await expect(decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: foreignLine.id, label: 'Autre' }, { today: TODAY })).rejects.toThrow(/Ligne de budget introuvable/)
    expect((await budgets.getBudget(other.companyId, otherBudget.id)).lines.every((l) => l.recurringItems.length === 0)).toBe(true)
    expect(await prisma.subscriptionDecision.count()).toBe(1)
  })

  it('writes neither the item nor the decision when the budget refuses it (start month outside the year, closed year), and refuses weekly subscriptions', async () => {
    const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'posts' })
    const line62 = budget.lines.find((l) => l.accountPrefix === '62')!
    const weekly = []
    for (const d of ['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01']) weekly.push(await line(bankAccountId, d, 25, 'Panier Frais'))
    await expect(decide.addSubscriptionToBudget(books.companyId, { subscriptionId: weekly[0].id, budgetLineId: line62.id }, { today: TODAY })).rejects.toThrow(/hebdomadaire/)

    const rows = await phonePlan()
    // An item whose start month never falls in the year is refused by the budgets service: no decision either
    await expect(decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: line62.id, startMonth: '2027-02' }, { today: TODAY })).rejects.toThrow(/ne tombe dans aucun mois/)
    expect(await prisma.subscriptionDecision.count()).toBe(0)

    await prisma.fiscalYear.update({ where: { id: books.fiscalYearId }, data: { isClosed: true } })
    await expect(decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: line62.id }, { today: TODAY })).rejects.toThrow(/clôturé/)
    expect(await prisma.budgetRecurringItem.count()).toBe(0)
    expect(await prisma.subscriptionDecision.count()).toBe(0)
  })

  it('keeps the decision when the budget line is deleted, without its link', async () => {
    const rows = await phonePlan()
    const budget = await budgets.createBudget(books.companyId, { fiscalYearId: books.fiscalYearId, template: 'posts' })
    const line62 = budget.lines.find((l) => l.accountPrefix === '62')!
    await decide.addSubscriptionToBudget(books.companyId, { subscriptionId: rows[0].id, budgetLineId: line62.id }, { today: TODAY })
    await budgets.deleteBudgetLine(books.companyId, line62.id)
    const [sub] = (await detect.listDetectedSubscriptions(books.companyId, { today: TODAY })).items
    expect(sub.decision).toMatchObject({ status: 'confirmed', budgetLine: null })
  })
})
