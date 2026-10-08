import { describe, expect, it, vi } from 'vitest'
import { fetchPontoInstitutions, PontoClient } from '@/lib/banking/providers/ponto/client'
import { mapPontoInstitution, PontoProvider } from '@/lib/banking/providers/ponto/provider'
import { BankAuthorizationError } from '@/lib/banking/errors'
import { ExternalServiceError, RateLimitError } from '@/lib/accounting/errors'
import {
  ACCOUNT_ID,
  accountsPage,
  API,
  INSTITUTION_ID,
  institutionsPage,
  pontoError,
  token,
  transaction,
  transactionsPage,
} from './fixtures/ponto'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/vnd.api+json' } })
}

interface Call {
  url: string
  init?: RequestInit
}

function fakePonto(routes: (url: URL, init?: RequestInit) => Response | undefined) {
  const calls: Call[] = []
  let tokens = 0
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === `${API}/oauth2/token`) return json({ ...token, access_token: `ponto_access_${++tokens}` })
    return routes(new URL(url), init) ?? json(pontoError('resourceNotFound', 'Not found'), 404)
  })
  return { calls, fetch: fetchImpl as unknown as typeof fetch }
}

const options = (fetchImpl: typeof fetch, now?: () => Date) => ({
  clientId: 'client-id-1',
  clientSecret: 'client-secret-1',
  apiUrl: API,
  fetch: fetchImpl,
  now,
})

describe('Ponto access token (client credentials)', () => {
  it('authenticates with HTTP Basic client_id:client_secret and caches the 30 minute token', async () => {
    let now = new Date('2026-10-03T10:00:00Z')
    const { calls, fetch } = fakePonto((url) => (url.pathname === '/accounts' ? json(accountsPage) : undefined))
    const client = new PontoClient(options(fetch, () => now))
    await client.listAccounts()
    await client.listAccounts()

    const tokenCalls = calls.filter((c) => c.url.endsWith('/oauth2/token'))
    expect(tokenCalls).toHaveLength(1)
    const headers = new Headers(tokenCalls[0].init?.headers)
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('client-id-1:client-secret-1').toString('base64')}`)
    expect(String(tokenCalls[0].init?.body)).toBe('grant_type=client_credentials')
    expect(tokenCalls[0].init?.method).toBe('POST')
    expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer ponto_access_1')

    // A minute before the 1799 s expiry the token is renewed
    now = new Date('2026-10-03T10:29:30Z')
    await client.listAccounts()
    expect(calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(2)
  })

  it('maps a refused client to a bank authorization error in French, without the Ponto detail', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'invalid_client', error_description: 'Client authentication failed' }, 401))
    const client = new PontoClient(options(fetchImpl as unknown as typeof fetch))
    const error = await client.listAccounts().catch((e) => e)
    expect(error).toBeInstanceOf(BankAuthorizationError)
    expect(error.message).toContain("Ponto refuse l'accès")
    expect(error.message).not.toContain('Client authentication failed')
  })
})

describe('Ponto JSON:API responses', () => {
  it('maps accounts, skipping deprecated ones, with IBAN, balances, consent expiry and bank logo', async () => {
    const { fetch } = fakePonto((url) => {
      if (url.pathname === '/accounts') return json(accountsPage)
      if (url.pathname === `/financial-institutions/${INSTITUTION_ID}`) return json({ data: institutionsPage.data[0] })
      return undefined
    })
    const accounts = await new PontoProvider(options(fetch)).listAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({
      externalId: ACCOUNT_ID,
      iban: 'FR7630004000031234567890143',
      name: 'Compte courant pro',
      currency: 'EUR',
      balance: 8150.15,
      availableBalance: 8200.15,
      institution: { id: INSTITUTION_ID, name: 'BNP Paribas - Ma Banque Entreprise' },
    })
    expect(accounts[0].providerData?.institutionLogoUrl).toBe(institutionsPage.data[0].attributes.logoUrl)
    expect(accounts[0].consentExpiresAt?.toISOString()).toBe('2027-03-30T09:55:40.898Z')
  })

  it('follows links.next across pages and maps booked transactions', async () => {
    const next = `${API}/accounts/${ACCOUNT_ID}/transactions?page%5Blimit%5D=100&page%5Bafter%5D=t2`
    const { calls, fetch } = fakePonto((url) => {
      if (!url.pathname.endsWith('/transactions')) return undefined
      return url.searchParams.get('page[after]')
        ? json(transactionsPage([transaction('t3', '2026-09-20T10:00:00.000Z', 250)]))
        : json(transactionsPage([transaction('t1', '2026-09-28T10:00:00.000Z', -99.01), transaction('t2', '2026-09-25T10:00:00.000Z', 1200)], next))
    })
    const txs = await new PontoProvider(options(fetch)).syncTransactions(ACCOUNT_ID)
    expect(txs.map((t) => t.externalId)).toEqual(['t1', 't2', 't3'])
    expect(txs[0]).toMatchObject({
      amount: 99.01,
      side: 'debit',
      state: 'booked',
      label: 'FACTURE t1',
      counterpartyName: 'Client Durand',
      reference: 'E2E-t1',
    })
    expect(txs[0].date.toISOString()).toBe('2026-09-28T00:00:00.000Z')
    expect(txs[1].side).toBe('credit')
    expect(calls.some((c) => c.url.includes('pending-transactions'))).toBe(false)
  })

  it('stops paging once a page is older than the sync window', async () => {
    const next = `${API}/accounts/${ACCOUNT_ID}/transactions?page%5Bafter%5D=t2`
    const { calls, fetch } = fakePonto((url) => {
      if (!url.pathname.endsWith('/transactions')) return undefined
      return json(transactionsPage([transaction('t1', '2026-08-01T10:00:00.000Z', 1), transaction('t2', '2026-07-01T10:00:00.000Z', 2)], next))
    })
    const txs = await new PontoProvider(options(fetch)).syncTransactions(ACCOUNT_ID, new Date('2026-09-01T00:00:00Z'))
    expect(txs).toEqual([])
    expect(calls.filter((c) => c.url.includes('/transactions'))).toHaveLength(1)
  })

  it('refuses a pagination link to another host', async () => {
    const { fetch } = fakePonto((url) => {
      if (!url.pathname.endsWith('/transactions')) return undefined
      return json(transactionsPage([transaction('t1', '2026-09-28T10:00:00.000Z', 1)], 'https://evil.example/steal'))
    })
    await expect(new PontoProvider(options(fetch)).syncTransactions(ACCOUNT_ID)).rejects.toBeInstanceOf(ExternalServiceError)
  })

  it('maps JSON:API errors to French messages: 429 to a rate limit, known codes to their advice, never the Ponto detail', async () => {
    const limited = fakePonto(() => json(pontoError('tooManyRequests', 'Slow down'), 429))
    await expect(new PontoClient(options(limited.fetch)).listAccounts()).rejects.toBeInstanceOf(RateLimitError)
    const broken = fakePonto(() => json(pontoError('accountRecentlySynchronized', 'Synchronization refused'), 400))
    const error = await new PontoClient(options(broken.fetch)).listAccounts().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect((error as Error).message).toBe('Ponto a synchronisé ce compte avec la banque il y a peu : réessayez dans quelques minutes.')
    expect((error as Error).message).not.toContain('Synchronization refused')
  })

  it('reports health from the account meta: last Ponto sync, earliest consent expiry, sync errors', async () => {
    const withError = structuredClone(accountsPage)
    withError.data[0].meta!.latestSynchronization.attributes.errors = [{ code: 'authorizationExpired', detail: 'Authorization expired' }] as never[]
    const { fetch } = fakePonto((url) => (url.pathname === '/accounts' ? json(withError) : undefined))
    const health = await new PontoProvider(options(fetch)).getConnectionHealth()
    expect(health.lastSyncAt?.toISOString()).toBe('2026-10-03T06:00:05.000Z')
    expect(health.consentExpiresAt?.toISOString()).toBe('2027-03-30T09:55:40.898Z')
    expect(health.error).toBe('Authorization expired')
  })
})

describe('Ponto manual synchronization', () => {
  it('sends the present user IP for details and transactions', async () => {
    const { calls, fetch } = fakePonto((url, init) =>
      url.pathname === '/synchronizations' && init?.method === 'POST' ? json({ data: { id: 's1', type: 'synchronization', attributes: { status: 'pending' } } }, 201) : undefined,
    )
    await new PontoProvider(options(fetch)).requestRefresh(ACCOUNT_ID, '203.0.113.7')
    const bodies = calls.filter((c) => c.url.endsWith('/synchronizations')).map((c) => JSON.parse(String(c.init?.body)))
    expect(bodies.map((b) => b.data.attributes.subtype)).toEqual(['accountDetails', 'accountTransactions'])
    expect(bodies[0].data).toEqual({
      type: 'synchronization',
      attributes: { resourceType: 'account', resourceId: ACCOUNT_ID, subtype: 'accountDetails', customerIpAddress: '203.0.113.7' },
    })
  })
})

describe('Ponto financial institutions', () => {
  it('reads the public list filtered by country, without a token', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      return json(institutionsPage)
    }) as unknown as typeof fetch
    const list = await fetchPontoInstitutions('FR', { apiUrl: API, fetch: fetchImpl })
    expect(calls[0]).toBe(`${API}/financial-institutions?filter%5Bcountry%5D%5Beq%5D=FR&page%5Blimit%5D=100`)
    expect(list).toHaveLength(2)
    expect(mapPontoInstitution(list[0])).toEqual({
      id: INSTITUTION_ID,
      name: 'BNP Paribas - Ma Banque Entreprise',
      country: 'FR',
      logoUrl: 'https://ibanity-production-financial-institution-assets.s3.eu-central-1.amazonaws.com/bnp.svg',
      primaryColor: '#009662',
      status: 'beta',
      expectedAuthorizationLifetime: 180,
    })
  })
})
