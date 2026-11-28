/**
 * What Kledg sets up when Stripe is connected (lib/banking/stripe-setup.service.ts),
 * against PostgreSQL:
 * - the Stripe account 517100 (or 467100) in every open fiscal year, a code
 *   held by another account skipped, nothing created twice;
 * - the Stripe rules of the library, above the company's own rules, fees
 *   and payouts applied without a click; a rule the company already has is
 *   kept and reported (a "Virements Stripe" rule on 467 would count each
 *   payout twice);
 * - the sync maps the euro Stripe account to that account and leaves an
 *   account in another currency unmapped (#131), and stores the lines with
 *   their Stripe operation types, which the Stripe rules match.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('stripe_setup')
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { BankProvider, ProviderAccount, ProviderTransaction } from '@/lib/banking/providers/types'
import { mapStripeBalanceTransaction } from '@/lib/banking/providers/stripe/map'
import type { StripeBalanceTransaction } from '@/lib/banking/providers/stripe/client'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let setup: typeof import('@/lib/banking/stripe-setup.service')
let syncIntegration: typeof import('@/lib/integrations/sync').syncIntegration
let addRuleFromTemplate: typeof import('@/lib/rules-library/manage-rule-templates.service').addRuleFromTemplate
let findMatchingRules: typeof import('@/lib/transactions/rule-matcher').findMatchingRules

const NOW = new Date('2026-09-20T08:00:00Z')
const ids = {} as Record<string, string>

/** The accounts the Stripe rules need, and their parents; 6278, 706 and 58 are created by the setup. */
const CHART = ['4', '44', '445', '4452', '44566', '44571', '46', '467', '5', '51', '512', '512000', '517', '6', '62', '627', '7', '70']

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
  const closed = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z'), isClosed: true },
  })
  const open = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  for (const fiscalYearId of [closed.id, open.id]) {
    for (const code of CHART) await prisma.account.create({ data: { companyId: company.id, fiscalYearId, code, label: `Compte ${code}` } })
  }
  Object.assign(ids, { company: company.id, closed: closed.id, open: open.id })
}

const accountsOf = (fiscalYearId: string, startsWith: string) =>
  prisma.account.findMany({ where: { companyId: ids.company, fiscalYearId, code: { startsWith } }, select: { code: true, label: true }, orderBy: { code: 'asc' } })

function fakeStripe(accounts: ProviderAccount[], lines: ProviderTransaction[]): BankProvider {
  return {
    id: 'STRIPE',
    kind: 'direct',
    listAccounts: async () => accounts,
    syncTransactions: async (accountExternalId) => lines.filter((l) => l.accountExternalId === accountExternalId),
    getBalances: async () => [],
    getConnectionHealth: async () => ({ lastSyncAt: null, consentExpiresAt: null, error: null }),
  }
}

const payment: StripeBalanceTransaction = {
  id: 'txn_pay',
  amount: 12000,
  fee: 205,
  net: 11795,
  currency: 'eur',
  created: Date.UTC(2026, 8, 18, 10) / 1000,
  available_on: Date.UTC(2026, 8, 20) / 1000,
  type: 'charge',
  reporting_category: 'charge',
  description: 'Abonnement Pro',
  source: 'ch_1',
  status: 'available',
}
const payout: StripeBalanceTransaction = { ...payment, id: 'txn_po', amount: -11795, fee: 0, net: -11795, type: 'payout', reporting_category: 'payout', description: 'STRIPE PAYOUT', source: 'po_1' }

describe.skipIf(!available)('Stripe connection setup', () => {
  beforeAll(async () => {
    await prepareTestDatabase('stripe_setup')
    ;({ prisma } = await import('@/lib/prisma'))
    setup = await import('@/lib/banking/stripe-setup.service')
    ;({ syncIntegration } = await import('@/lib/integrations/sync'))
    ;({ addRuleFromTemplate } = await import('@/lib/rules-library/manage-rule-templates.service'))
    ;({ findMatchingRules } = await import('@/lib/transactions/rule-matcher'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('stripe_setup')
    await seed()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates 517100 Stripe in the open fiscal years only, and the Stripe rules, once', async () => {
    const first = await setup.setUpStripeBooks(ids.company, '517')
    expect(first.ledgerAccountCode).toBe('517100')
    expect(await accountsOf(ids.open, '5171')).toEqual([{ code: '517100', label: 'Stripe' }])
    expect(await accountsOf(ids.closed, '5171')).toEqual([])
    expect(first.rules.added).toHaveLength(6)
    expect(first.rules.kept).toEqual([])

    const rules = await prisma.transactionRule.findMany({
      where: { companyId: ids.company },
      select: { name: true, priority: true, autoCreate: true, entryLines: { select: { accountCode: true, vatType: true, vatOnDebit: true } } },
      orderBy: { name: 'asc' },
    })
    expect(rules.every((r) => r.priority === 10)).toBe(true)
    const byName = new Map(rules.map((r) => [r.name, r]))
    // Fees and payouts without a click; sales and refunds wait for a look (their VAT rate depends on the sale)
    expect(byName.get('Commissions Stripe')).toMatchObject({ autoCreate: true, entryLines: [{ accountCode: '6278', vatType: null }] })
    expect(byName.get('Virements du compte Stripe vers la banque')).toMatchObject({ autoCreate: true, entryLines: [{ accountCode: '58' }] })
    expect(byName.get('Paiements reçus sur Stripe')).toMatchObject({ autoCreate: false, entryLines: [{ accountCode: '706', vatType: 'collectible', vatOnDebit: false }] })
    expect(byName.get('Remboursements Stripe')).toMatchObject({ entryLines: [{ accountCode: '706', vatType: 'collectible', vatOnDebit: true }] })
    // The accounts the rules need, created under their PCG parents
    expect((await accountsOf(ids.open, '6278')).map((a) => a.code)).toEqual(['6278'])
    expect((await accountsOf(ids.open, '58')).map((a) => a.code)).toEqual(['58'])

    const again = await setup.setUpStripeBooks(ids.company, '517')
    expect(again.ledgerAccountCode).toBe('517100')
    expect(again.rules.added).toEqual([])
    expect(again.rules.kept).toHaveLength(6)
    expect(await prisma.transactionRule.count({ where: { companyId: ids.company } })).toBe(6)
    expect(await accountsOf(ids.open, '5171')).toHaveLength(1)
  })

  it('uses 467 when chosen, skipping a code another account holds', async () => {
    await prisma.account.create({ data: { companyId: ids.company, fiscalYearId: ids.open, code: '467100', label: 'Associé Martin' } })
    expect(await setup.ensureStripeLedgerAccount(ids.company, '467')).toBe('467101')
    expect(await accountsOf(ids.open, '4671')).toEqual([
      { code: '467100', label: 'Associé Martin' },
      { code: '467101', label: 'Stripe' },
    ])
  })

  it('keeps and reports a Virements Stripe rule the company already has', async () => {
    await addRuleFromTemplate(ids.company, 'stripe-virements', { createMissingAccounts: true })
    const { kept } = await setup.installStripeRules(ids.company)
    expect(kept).toEqual([{ template: 'Virements Stripe reçus (compte Stripe connecté)', rule: 'Virements Stripe' }])
  })

  it('maps the euro Stripe account to 517100 and stores lines the Stripe rules match', async () => {
    await setup.setUpStripeBooks(ids.company, '517')
    const integration = await prisma.integration.create({
      data: {
        companyId: ids.company,
        provider: 'STRIPE',
        type: 'BANKING',
        name: 'Stripe',
        status: 'active',
        credentials: {},
        credentialsEncrypted: false,
        config: { balanceAccount: '517' },
        featureConfigs: { create: [{ feature: 'BANKING_ACCOUNTS' }, { feature: 'BANKING_TRANSACTIONS' }] },
      },
    })
    const provider = fakeStripe(
      [
        { externalId: 'EUR', iban: null, name: 'Stripe EUR', currency: 'EUR', balance: 0 },
        { externalId: 'USD', iban: null, name: 'Stripe USD', currency: 'USD', balance: 0 },
      ],
      [...mapStripeBalanceTransaction(payment, 'EUR'), ...mapStripeBalanceTransaction(payout, 'EUR')],
    )
    const result = await syncIntegration(integration.id, 'unused-key', undefined, { provider, now: NOW })
    expect(result.errors).toEqual([])

    const accounts = await prisma.bankAccount.findMany({ select: { externalAccountId: true, ledgerAccountCode: true }, orderBy: { externalAccountId: 'asc' } })
    expect(accounts).toEqual([
      { externalAccountId: 'EUR', ledgerAccountCode: '517100' },
      { externalAccountId: 'USD', ledgerAccountCode: null },
    ])

    const lines = await prisma.bankTransaction.findMany({
      select: { externalTransactionId: true, side: true, amount: true, operationType: true, status: true, label: true, reference: true, counterpartyName: true, category: true, cashflowCategory: true, cashflowSubcategory: true },
      orderBy: { externalTransactionId: 'asc' },
    })
    expect(lines.map((l) => [l.externalTransactionId, l.side, l.amount.toString(), l.operationType, l.status])).toEqual([
      ['txn_pay', 'credit', '120', 'stripe.charge', null],
      ['txn_pay:fee', 'debit', '2.05', 'stripe.fee', null],
      ['txn_po', 'debit', '117.95', 'stripe.payout', null],
    ])

    const rules = await prisma.transactionRule.findMany({ where: { companyId: ids.company }, include: { conditions: true } })
    const matchable = rules.map((r) => ({ id: r.id, name: r.name, priority: r.priority, autoCreate: r.autoCreate, conditions: r.conditions }))
    const ruleFor = (line: (typeof lines)[number]) =>
      findMatchingRules(matchable, { ...line, amount: Number(line.amount) }).map((m) => rules.find((r) => r.id === m.ruleId)?.name)[0]
    expect(lines.map(ruleFor)).toEqual(['Paiements reçus sur Stripe', 'Commissions Stripe', 'Virements du compte Stripe vers la banque'])
  })
})
