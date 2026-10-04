import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QontoProvider } from '@/lib/banking/providers/qonto'
import { shouldStoreTransaction } from '@/lib/banking/providers/types'

const organization = {
  organization: {
    bank_accounts: [
      { slug: 'main-1', iban: 'FR7616958000016543210987654', bic: 'QNTOFRP1', currency: 'EUR', balance: 1520.5, balance_cents: 152050, authorized_balance: 1500, authorized_balance_cents: 150000 },
    ],
  },
}

const tx = (over: Record<string, unknown>) => ({
  transaction_id: 'tx-1',
  amount: 42.1,
  amount_cents: 4210,
  local_amount: 42.1,
  side: 'debit',
  operation_type: 'card',
  currency: 'EUR',
  local_currency: 'EUR',
  label: 'Boulangerie',
  settled_at: '2026-09-02T10:00:00.000Z',
  emitted_at: '2026-09-01T09:00:00.000Z',
  created_at: '2026-09-01T22:30:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z',
  status: 'completed',
  vat_rate: 5.5,
  vat_amount_cents: 219,
  clean_counterparty_name: 'Boulangerie Martin',
  cashflow_category: { name: 'Repas' },
  ...over,
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('QontoProvider (BankProvider over the Qonto Business API)', () => {
  const calls: string[] = []

  beforeEach(() => {
    process.env.QONTO_API_URL = 'https://qonto.test/v2'
    calls.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.endsWith('/organization')) return json(organization)
        const page = new URL(url).searchParams.get('page')
        if (page === '1' || !page) {
          return json({ transactions: [tx({}), tx({ transaction_id: 'tx-2', status: 'pending', vat_rate: -1 })], meta: { current_page: 1, next_page: 2, prev_page: null } })
        }
        return json({ transactions: [tx({ transaction_id: 'tx-3', status: 'declined', side: 'credit' })], meta: { current_page: 2, next_page: null, prev_page: 1 } })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.QONTO_API_URL
  })

  it('lists accounts keyed by IBAN, as before the refactor', async () => {
    const provider = new QontoProvider({ login: 'org-slug', secretKey: 'secret' })
    const [account] = await provider.listAccounts()
    expect(account).toMatchObject({ externalId: 'FR7616958000016543210987654', iban: 'FR7616958000016543210987654', name: 'main-1', balance: 1520.5, currency: 'EUR' })
    expect(provider.kind).toBe('direct')
  })

  it('reads every page since the given day and maps the Qonto fields', async () => {
    const provider = new QontoProvider({ login: 'org-slug', secretKey: 'secret' })
    const txs = await provider.syncTransactions('FR7616958000016543210987654', new Date('2026-07-01T00:00:00Z'))
    expect(txs.map((t) => t.externalId)).toEqual(['tx-1', 'tx-2', 'tx-3'])
    // The account is resolved first, then its transactions are read.
    expect(calls.find((u) => u.includes('/transactions'))).toContain('settled_at_from=2026-07-01T00%3A00%3A00Z')
    expect(txs[0]).toMatchObject({
      amount: 42.1,
      side: 'debit',
      state: 'booked',
      status: 'completed',
      counterpartyName: 'Boulangerie Martin',
      cashflowCategory: 'Repas',
      vatRate: 5.5,
      vatAmount: 2.19,
    })
    // created_at day, as a UTC calendar day
    expect(txs[0].date.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    // Qonto reports non standard VAT rates as -1
    expect(txs[1].vatRate).toBeUndefined()
    expect(txs[1].state).toBe('pending')
    expect(txs[2].state).toBe('rejected')
  })

  it('keeps every Qonto line (status shown), unlike the other providers', async () => {
    const provider = new QontoProvider({ login: 'org-slug', secretKey: 'secret' })
    const txs = await provider.syncTransactions('FR7616958000016543210987654')
    expect(txs.filter((t) => shouldStoreTransaction('QONTO', t))).toHaveLength(3)
    expect(txs.filter((t) => shouldStoreTransaction('PONTO', t))).toHaveLength(1)
  })

  it('refuses missing credentials', () => {
    expect(() => new QontoProvider({ login: '', secretKey: '' })).toThrow()
  })
})
