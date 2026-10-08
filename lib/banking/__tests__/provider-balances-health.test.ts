/**
 * Balances, connection health and the account keys of the direct bank
 * providers (lib/banking/providers/qonto.ts, lib/banking/providers/revolut/provider.ts),
 * with the bank APIs answered by a stubbed or injected fetch (no network).
 * Health checks report the French reason of lib/banking/errors.ts, never the
 * provider's own message or the credentials.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { mapQontoTransaction, QontoProvider } from '@/lib/banking/providers/qonto'
import { RevolutProvider } from '@/lib/banking/providers/revolut/provider'
import { generateRevolutKeyMaterial } from '@/lib/banking/providers/revolut/certificate'
import { UNEXPECTED_BANK_ERROR_MESSAGE } from '@/lib/banking/errors'
import type { QontoTransaction } from '@/lib/integrations/providers/qonto/types'
import { ACCOUNT_EUR, accounts } from './fixtures/revolut'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const QONTO_ACCOUNT_ID = '5f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
const SANDBOX_ACCOUNT_ID = '6a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const IBAN = 'FR7616958000016543210987654'

const organization = {
  organization: {
    bank_accounts: [
      { id: QONTO_ACCOUNT_ID, slug: 'main-1', iban: IBAN, bic: 'QNTOFRP1', currency: 'EUR', balance: 1520.5, balance_cents: 152050, authorized_balance: 1500, authorized_balance_cents: 150000 },
      // Sandbox: masked IBAN, keyed by the account id
      { id: SANDBOX_ACCOUNT_ID, slug: '', iban: 'FRXXXXXXXXXXXXXXXXXXXXXX123', bic: 'QNTOFRP1', currency: 'EUR', balance: 0.1, balance_cents: 10, authorized_balance: 0, authorized_balance_cents: 0 },
    ],
  },
}

const qontoTx = (over: Partial<QontoTransaction>): QontoTransaction => ({
  transaction_id: 'tx-1',
  amount: 10,
  amount_cents: 1000,
  local_amount: 10,
  side: 'debit',
  operation_type: 'card',
  currency: 'EUR',
  local_currency: 'EUR',
  label: 'Libellé',
  settled_at: '2026-09-02T10:00:00.000Z',
  emitted_at: '2026-09-01T09:00:00.000Z',
  updated_at: '2026-09-02T10:00:00.000Z',
  status: 'completed',
  ...over,
})

describe('QontoProvider', () => {
  const calls: string[] = []
  let organizationResponse: () => Response

  beforeEach(() => {
    process.env.QONTO_API_URL = 'https://qonto.test/v2'
    calls.length = 0
    organizationResponse = () => json(organization)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        if (url.endsWith('/organization')) return organizationResponse()
        return json({ transactions: [qontoTx({})], meta: { current_page: 1, next_page: null, prev_page: null } })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.QONTO_API_URL
  })

  const provider = () => new QontoProvider({ login: 'org-slug', secretKey: 'super-secret-key' })

  it('keys a masked sandbox IBAN by the Qonto account id, and names a nameless account by its IBAN', async () => {
    const list = await provider().listAccounts()
    expect(list.map((a) => [a.externalId, a.name, a.balance])).toEqual([
      [IBAN, 'main-1', 1520.5],
      [SANDBOX_ACCOUNT_ID, 'FRXXXXXXXXXXXXXXXXXXXXXX123', 0.1],
    ])
  })

  it('reads transactions by the Qonto account id resolved from the stored IBAN or id', async () => {
    await provider().syncTransactions(IBAN)
    await provider().syncTransactions(SANDBOX_ACCOUNT_ID)
    const transactionCalls = calls.filter((u) => u.includes('/transactions')).map((u) => new URL(u).searchParams.get('bank_account_id'))
    expect(transactionCalls).toEqual([QONTO_ACCOUNT_ID, SANDBOX_ACCOUNT_ID])
    // No since: no date filter
    expect(calls.filter((u) => u.includes('/transactions')).some((u) => u.includes('settled_at_from'))).toBe(false)
  })

  it('falls back to the stored identifier when the organization no longer lists the account', async () => {
    const txs = await provider().syncTransactions('FR7630004000031234567890143')
    expect(new URL(calls.find((u) => u.includes('/transactions'))!).searchParams.get('iban')).toBe('FR7630004000031234567890143')
    expect(txs[0].accountExternalId).toBe('FR7630004000031234567890143')
  })

  it('returns the current and authorized balance of each account, keyed by IBAN', async () => {
    expect(await provider().getBalances()).toEqual([
      { accountExternalId: IBAN, current: 1520.5, available: 1500, currency: 'EUR' },
      { accountExternalId: 'FRXXXXXXXXXXXXXXXXXXXXXX123', current: 0.1, available: 0, currency: 'EUR' },
    ])
  })

  it('reports a healthy connection, and a refused key with the French advice only', async () => {
    expect(await provider().getConnectionHealth()).toEqual({ lastSyncAt: null, consentExpiresAt: null, error: null })

    organizationResponse = () => json({ errors: [{ detail: 'API key super-secret-key revoked' }] }, 401)
    const health = await provider().getConnectionHealth()
    expect(health.error).toBe(
      "Qonto refuse l'accès : vérifiez l'identifiant et la clé secrète de l'API, puis mettez-les à jour depuis la page Banque.",
    )
    expect(health.error).not.toContain('super-secret-key')
  })

  it('reports an unreachable Qonto in French', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    expect((await provider().getConnectionHealth()).error).toBe('Qonto est injoignable. Réessayez dans quelques minutes.')
  })
})

describe('mapQontoTransaction', () => {
  it('prefers vat_amount over vat_amount_cents and the small logo over the medium one', () => {
    const line = mapQontoTransaction(
      qontoTx({ vat_amount: 3.33, vat_amount_cents: 999, logo: { small: 'https://logo/s.png', medium: 'https://logo/m.png' }, vat_rate: 20 }),
      IBAN,
    )
    expect(line).toMatchObject({ vatAmount: 3.33, vatRate: 20, logoUrl: 'https://logo/s.png' })
    expect(mapQontoTransaction(qontoTx({ logo: { medium: 'https://logo/m.png' } }), IBAN).logoUrl).toBe('https://logo/m.png')
  })

  it('maps a reversed payment to rejected and an unknown status to booked', () => {
    expect(mapQontoTransaction(qontoTx({ status: 'reversed' }), IBAN)).toMatchObject({ state: 'rejected', status: 'reversed' })
    expect(mapQontoTransaction(qontoTx({ status: 'settled' }), IBAN)).toMatchObject({ state: 'booked', status: 'settled' })
  })

  it('dates a line without created_at by its settlement day, a UTC calendar day', () => {
    const line = mapQontoTransaction(qontoTx({ created_at: null, settled_at: '2026-09-30T23:30:00.000Z' }), IBAN)
    expect(line.date.toISOString()).toBe('2026-09-30T00:00:00.000Z')
    expect(line.valueDate).toBe('2026-09-30')
  })

  it('leaves empty optional fields undefined', () => {
    const line = mapQontoTransaction(qontoTx({ note: '', category: '', operation_type: '', cashflow_category: null, vat_rate: null }), IBAN)
    expect(line.note).toBeUndefined()
    expect(line.category).toBeUndefined()
    expect(line.operationType).toBeUndefined()
    expect(line.cashflowCategory).toBeUndefined()
    expect(line.vatRate).toBeUndefined()
    expect(line.vatAmount).toBeUndefined()
  })
})

describe('RevolutProvider balances and health', () => {
  const API = 'https://sandbox-b2b.revolut.com/api/1.0'
  const material = generateRevolutKeyMaterial({ commonName: 'kledg.example.com', now: new Date('2026-10-03T10:00:00Z') })

  function revolut(accountsResponse: () => Response, authorizedAt: Date | null = new Date('2026-10-01T00:00:00Z')) {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === `${API}/auth/token`) return json({ access_token: 'oa_sand_access', token_type: 'bearer', expires_in: 2399 })
      if (url === `${API}/accounts`) return accountsResponse()
      return json({ message: 'Not found' }, 404)
    })
    return new RevolutProvider({
      apiUrl: API,
      clientId: 'client-abc12345',
      issuer: 'kledg.example.com',
      privateKeyPem: material.privateKeyPem,
      refreshToken: 'oa_sand_refresh_secret',
      authorizedAt,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-10-03T10:00:00Z'),
    })
  }

  it('returns the balance of active EUR accounts only, without an available amount', async () => {
    expect(await revolut(() => json(accounts)).getBalances()).toEqual([
      { accountExternalId: ACCOUNT_EUR, current: 12450.32, available: null, currency: 'EUR' },
    ])
  })

  it('reports the consent expiry 90 days after the authorization', async () => {
    expect(await revolut(() => json(accounts)).getConnectionHealth()).toEqual({
      lastSyncAt: null,
      consentExpiresAt: new Date('2026-12-30T00:00:00Z'),
      error: null,
    })
    expect((await revolut(() => json(accounts), null).getConnectionHealth()).consentExpiresAt).toBeNull()
  })

  it('reports a revoked access with the French advice, and an unexpected failure with the generic message', async () => {
    const revoked = await revolut(() => json({ message: 'The access token oa_sand_access is revoked' }, 401)).getConnectionHealth()
    expect(revoked.error).toBe("Revolut refuse l'accès : autorisez de nouveau Kledg dans Revolut Business.")
    expect(revoked.consentExpiresAt).toEqual(new Date('2026-12-30T00:00:00Z'))

    const broken = await revolut(() => new Response('not json', { status: 200 })).getConnectionHealth()
    expect(broken.error).toBe(UNEXPECTED_BANK_ERROR_MESSAGE)
  })
})
