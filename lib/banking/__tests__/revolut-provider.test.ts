import { createPrivateKey, createPublicKey, verify, X509Certificate } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import { generateRevolutKeyMaterial } from '@/lib/banking/providers/revolut/certificate'
import { buildClientAssertion, CLIENT_ASSERTION_TYPE, issuerFromRedirectUri } from '@/lib/banking/providers/revolut/jwt'
import { RevolutClient } from '@/lib/banking/providers/revolut/client'
import { mapRevolutTransaction, RevolutProvider } from '@/lib/banking/providers/revolut/provider'
import type { RevolutTransaction } from '@/lib/banking/providers/revolut/client'
import { shouldStoreTransaction } from '@/lib/banking/providers/types'
import { newTransactions } from '@/lib/banking/sync-rules'
import { ExternalServiceError, RateLimitError } from '@/lib/accounting/errors'
import { BankAuthorizationError } from '@/lib/banking/errors'
import { ACCOUNT_EUR, ACCOUNT_GBP, accounts, bankDetailsEur, cardPayment, internalTransfer } from './fixtures/revolut'

const API = 'https://sandbox-b2b.revolut.com/api/1.0'
const material = generateRevolutKeyMaterial({ commonName: 'kledg.example.com', now: new Date('2026-10-03T10:00:00Z') })

function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface Call {
  url: string
  init?: RequestInit
}

/** A fetch answering the token endpoint and the given routes, recording calls. */
function fakeRevolut(routes: (url: URL, init?: RequestInit) => Response | undefined) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === `${API}/auth/token`) {
      return json({ access_token: `oa_sand_${calls.length}`, token_type: 'bearer', expires_in: 2399 })
    }
    return routes(new URL(url), init) ?? json({ message: 'Not found' }, 404)
  })
  return { calls, fetch: fetchImpl as unknown as typeof fetch }
}

function client(fetchImpl: typeof fetch, now = () => new Date('2026-10-03T10:00:00Z')) {
  return new RevolutClient({
    apiUrl: API,
    clientId: 'client-abc12345',
    issuer: 'kledg.example.com',
    privateKeyPem: material.privateKeyPem,
    refreshToken: 'oa_sand_refresh',
    fetch: fetchImpl,
    now,
  })
}

describe('Revolut certificate', () => {
  it('is a self-signed X.509 certificate matching the private key', () => {
    const cert = new X509Certificate(material.certificatePem)
    expect(cert.subject).toContain('CN=kledg.example.com')
    expect(cert.issuer).toBe(cert.subject)
    expect(cert.verify(cert.publicKey)).toBe(true)
    expect(cert.checkPrivateKey(createPrivateKey(material.privateKeyPem))).toBe(true)
    expect(new Date(cert.validTo).getTime()).toBe(material.notAfter.getTime())
    // Five years, like the openssl command of the Revolut guide
    expect(material.notAfter.getUTCFullYear()).toBe(2031)
  })
})

describe('Revolut client assertion (JWT)', () => {
  const now = new Date('2026-10-03T10:00:00Z')
  const jwt = buildClientAssertion({ clientId: 'client-abc12345', issuer: 'kledg.example.com', privateKeyPem: material.privateKeyPem, now })
  const [header, payload, signature] = jwt.split('.')

  it('carries the claims Revolut expects', () => {
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = decode(payload)
    expect(claims).toMatchObject({ iss: 'kledg.example.com', sub: 'client-abc12345', aud: 'https://revolut.com' })
    expect(claims.exp - claims.iat).toBe(300)
    expect(claims.iat).toBe(Math.floor(now.getTime() / 1000))
  })

  it('is signed RS256 with the key of the uploaded certificate', () => {
    const publicKey = createPublicKey(new X509Certificate(material.certificatePem).publicKey.export({ type: 'spki', format: 'pem' }))
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('uses the redirect URI domain as issuer', () => {
    expect(issuerFromRedirectUri('https://compta.example.fr/api/banking/revolut/callback')).toBe('compta.example.fr')
  })
})

describe('Revolut tokens', () => {
  it('exchanges the authorization code with a client assertion', async () => {
    const calls: Call[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return json({ access_token: 'oa_sand_access', token_type: 'bearer', expires_in: 2399, refresh_token: 'oa_sand_refresh_new' })
    }) as unknown as typeof fetch
    const c = new RevolutClient({ apiUrl: API, clientId: 'client-abc12345', issuer: 'kledg.example.com', privateKeyPem: material.privateKeyPem, fetch: fetchImpl })
    const tokens = await c.exchangeCode('oa_sand_code')
    expect(tokens.refresh_token).toBe('oa_sand_refresh_new')
    expect(calls[0].url).toBe(`${API}/auth/token`)
    const body = new URLSearchParams(String(calls[0].init?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('oa_sand_code')
    expect(body.get('client_id')).toBe('client-abc12345')
    expect(body.get('client_assertion_type')).toBe(CLIENT_ASSERTION_TYPE)
    expect(decode(body.get('client_assertion')!.split('.')[1]).sub).toBe('client-abc12345')
    expect(calls[0].init?.redirect).toBe('error')
  })

  it('refreshes the access token from the refresh token and reuses it until it expires', async () => {
    let now = new Date('2026-10-03T10:00:00Z')
    const { calls, fetch } = fakeRevolut((url) => (url.pathname.endsWith('/accounts') ? json(accounts) : undefined))
    const c = client(fetch, () => now)
    await c.getAccounts()
    await c.getAccounts()
    const tokenCalls = () => calls.filter((call) => call.url.endsWith('/auth/token'))
    expect(tokenCalls()).toHaveLength(1)
    const body = new URLSearchParams(String(tokenCalls()[0].init?.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('oa_sand_refresh')
    expect(new Headers(calls[1].init?.headers).get('authorization')).toBe('Bearer oa_sand_1')

    // 39 minutes later the token is about to expire (40 min): refreshed again
    now = new Date('2026-10-03T10:39:30Z')
    await c.getAccounts()
    expect(tokenCalls()).toHaveLength(2)
  })

  it('maps API errors: 401 to a bank authorization error, 429 to a rate limit', async () => {
    const unauthorized = fakeRevolut(() => json({ code: 9002, message: 'The access token is invalid' }, 401))
    await expect(client(unauthorized.fetch).getAccounts()).rejects.toBeInstanceOf(BankAuthorizationError)
    const limited = fakeRevolut(() => json({ message: 'Too many requests' }, 429))
    await expect(client(limited.fetch).getAccounts()).rejects.toBeInstanceOf(RateLimitError)
    const broken = fakeRevolut(() => json({ message: 'Internal error' }, 500))
    await expect(client(broken.fetch).getAccounts()).rejects.toThrow(ExternalServiceError)
  })

  it('needs an authorization before any call', async () => {
    const { fetch } = fakeRevolut(() => json(accounts))
    const c = new RevolutClient({ apiUrl: API, clientId: 'c', issuer: 'i', privateKeyPem: material.privateKeyPem, fetch })
    await expect(c.getAccounts()).rejects.toBeInstanceOf(BankAuthorizationError)
  })
})

describe('Revolut transactions', () => {
  it('pages backwards with `to` until a page is not full, without losing items sharing an instant', async () => {
    const page1 = [
      cardPayment('t5', '2026-09-05T10:00:00.000Z', -5),
      cardPayment('t4', '2026-09-04T10:00:00.000Z', -4),
      cardPayment('t3', '2026-09-03T10:00:00.000Z', -3),
    ]
    // t2 shares t3's instant: the next page starts 1 ms after it and returns t3 again
    const page2 = [cardPayment('t3', '2026-09-03T10:00:00.000Z', -3), cardPayment('t2', '2026-09-03T10:00:00.000Z', -2)]
    const { calls, fetch } = fakeRevolut((url) => {
      if (!url.pathname.endsWith('/transactions')) return undefined
      return json(url.searchParams.get('to') ? page2 : page1)
    })
    const txs = await client(fetch).getAllTransactions(ACCOUNT_EUR, new Date('2026-09-01T00:00:00Z'), 3)
    expect(txs.map((t) => t.id)).toEqual(['t5', 't4', 't3', 't2'])
    const pages = calls.filter((c) => c.url.includes('/transactions')).map((c) => new URL(c.url).searchParams)
    expect(pages).toHaveLength(2)
    expect(pages[0].get('account')).toBe(ACCOUNT_EUR)
    expect(pages[0].get('from')).toBe('2026-09-01T00:00:00.000Z')
    expect(pages[0].get('count')).toBe('3')
    expect(pages[1].get('to')).toBe('2026-09-03T10:00:00.001Z')
  })

  it('stops when a full page brings nothing new', async () => {
    const same = [cardPayment('a', '2026-09-03T10:00:00.000Z', -1), cardPayment('b', '2026-09-03T10:00:00.000Z', -2)]
    const { calls, fetch } = fakeRevolut((url) => (url.pathname.endsWith('/transactions') ? json(same) : undefined))
    const txs = await client(fetch).getAllTransactions(ACCOUNT_EUR, undefined, 2)
    expect(txs).toHaveLength(2)
    expect(calls.filter((c) => c.url.includes('/transactions'))).toHaveLength(2)
  })

  it('keeps only completed transactions for the books', () => {
    const states = ['completed', 'pending', 'created', 'declined', 'failed', 'reverted'] as const
    const lines = states.flatMap((state, i) =>
      mapRevolutTransaction(cardPayment(`s${i}`, '2026-09-03T10:00:00.000Z', -10, state) as unknown as RevolutTransaction, ACCOUNT_EUR),
    )
    expect(lines.map((l) => l.state)).toEqual(['booked', 'pending', 'pending', 'rejected', 'rejected', 'rejected'])
    expect(lines.filter((l) => shouldStoreTransaction('REVOLUT', l)).map((l) => l.status)).toEqual(['completed'])
  })

  it('maps one line per leg of the account, keyed by transaction id and leg id', () => {
    const tx = internalTransfer('x1', '2026-09-10T08:00:00.000Z') as unknown as RevolutTransaction
    const eur = mapRevolutTransaction(tx, ACCOUNT_EUR)
    const gbp = mapRevolutTransaction(tx, ACCOUNT_GBP)
    expect(eur).toHaveLength(1)
    expect(eur[0]).toMatchObject({ externalId: 'x1:x1-out', amount: 100, side: 'debit', label: 'To GBP', operationType: 'exchange' })
    expect(gbp[0]).toMatchObject({ externalId: 'x1:x1-in', amount: 86.5, side: 'credit' })
    // A second sync of the same transaction creates nothing
    expect(newTransactions(eur, ['x1:x1-out'])).toEqual([])
  })

  it('maps a card payment with merchant, amount sign and completion day', () => {
    const [line] = mapRevolutTransaction(cardPayment('c1', '2026-09-30T23:30:00.000Z', -47.8) as unknown as RevolutTransaction, ACCOUNT_EUR)
    expect(line).toMatchObject({ amount: 47.8, side: 'debit', counterpartyName: 'Papeterie Centrale', operationType: 'card_payment' })
    expect(line.date.toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })
})

describe('RevolutProvider accounts', () => {
  it('lists active EUR accounts with their IBAN and the 90 day consent expiry', async () => {
    const { fetch } = fakeRevolut((url) => {
      if (url.pathname.endsWith('/accounts')) return json(accounts)
      if (url.pathname.endsWith(`/accounts/${ACCOUNT_EUR}/bank-details`)) return json(bankDetailsEur)
      return undefined
    })
    const provider = new RevolutProvider({
      apiUrl: API,
      clientId: 'client-abc12345',
      issuer: 'kledg.example.com',
      privateKeyPem: material.privateKeyPem,
      refreshToken: 'oa_sand_refresh',
      authorizedAt: new Date('2026-10-01T00:00:00Z'),
      fetch,
    })
    const list = await provider.listAccounts()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ externalId: ACCOUNT_EUR, iban: 'LT123250000000000001', name: 'Main EUR', currency: 'EUR', balance: 12450.32 })
    expect(list[0].consentExpiresAt?.toISOString()).toBe('2026-12-30T00:00:00.000Z')
    expect(provider.kind).toBe('direct')
  })
})
