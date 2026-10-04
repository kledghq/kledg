import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { ExternalServiceError, RateLimitError, ValidationError } from '@/lib/accounting/errors'
import { BankAuthorizationError, errorReason, providerError, UNEXPECTED_BANK_ERROR_MESSAGE } from '@/lib/banking/errors'
import { QontoClient } from '@/lib/integrations/providers/qonto/client'
import { QontoProvider } from '@/lib/banking/providers/qonto'
import { revolutError } from '@/lib/banking/providers/revolut/client'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const SECRET_DETAIL = 'internal stack: user 4242 at db-7.qonto.internal'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('providerError: a provider failure as the user sees it', () => {
  it('maps statuses to typed errors with French messages and no provider detail', () => {
    const cases: Array<[number, new (...args: never[]) => Error]> = [
      [401, BankAuthorizationError],
      [403, BankAuthorizationError],
      [429, RateLimitError],
      [404, ExternalServiceError],
      [500, ExternalServiceError],
      [422, ExternalServiceError],
    ]
    for (const [status, type] of cases) {
      const error = providerError({ provider: 'Qonto', status, detail: SECRET_DETAIL })
      expect(error).toBeInstanceOf(type)
      expect(error.message).not.toContain(SECRET_DETAIL)
      expect(error.message).toMatch(/Qonto/)
      expect(error.message).not.toMatch(/[–—]/)
    }
  })

  it('gives known provider codes their own advice', () => {
    expect(providerError({ provider: 'Ponto', status: 400, code: 'authorizationExpired' })).toBeInstanceOf(BankAuthorizationError)
    expect(providerError({ provider: 'Ponto', status: 400, code: 'invalid_client' }).message).toContain('Ponto refuse')
  })

  it('maps Revolut responses the same way', async () => {
    const error = await revolutError(json({ message: SECRET_DETAIL }, 401))
    expect(error).toBeInstanceOf(BankAuthorizationError)
    expect(error.message).not.toContain(SECRET_DETAIL)
  })
})

describe('errorReason: what a sync stores and shows', () => {
  it('keeps the message of Kledg typed errors, on one line', () => {
    expect(errorReason(new ValidationError('Compte  introuvable\n: choisissez-en un.'))).toBe('Compte introuvable : choisissez-en un.')
  })

  it('never shows the message of an unexpected error', () => {
    const prisma = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on bank_transactions_pkey', {
      code: 'P2002',
      clientVersion: 'test',
    })
    expect(errorReason(prisma)).toBe(UNEXPECTED_BANK_ERROR_MESSAGE)
    expect(errorReason(new Error(SECRET_DETAIL))).toBe(UNEXPECTED_BANK_ERROR_MESSAGE)
    expect(errorReason('raw string')).toBe(UNEXPECTED_BANK_ERROR_MESSAGE)
  })
})

describe('QontoClient requests', () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let respond: (url: string) => Response

  beforeEach(() => {
    process.env.QONTO_API_URL = 'https://qonto.test/v2'
    calls.length = 0
    respond = () => json({})
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return respond(url)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.QONTO_API_URL
  })

  it('refuses redirects and bounds every call with a timeout', async () => {
    respond = () => json({ organization: { bank_accounts: [] } })
    await new QontoClient('org', 'key').getOrganization()
    expect(calls[0].url).toBe('https://qonto.test/v2/organization')
    expect(calls[0].init.redirect).toBe('error')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('encodes ids as one path segment', async () => {
    respond = () => json({ attachments: [] })
    await new QontoClient('org', 'key').listTransactionAttachments('../../organization?x=1')
    expect(calls[0].url).toBe('https://qonto.test/v2/transactions/..%2F..%2Forganization%3Fx%3D1/attachments')
    respond = () => json({ statement: null })
    await new QontoClient('org', 'key').getStatement('a/b')
    expect(calls[1].url).toBe('https://qonto.test/v2/statements/a%2Fb')
  })

  it('turns a refusal into a French error without the Qonto message', async () => {
    respond = () => json({ errors: [{ code: 'unauthorized', detail: SECRET_DETAIL }] }, 401)
    const error = await new QontoClient('org', 'key').getOrganization().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BankAuthorizationError)
    expect((error as Error).message).not.toContain(SECRET_DETAIL)

    respond = () => json({ message: 'slow down' }, 429)
    await expect(new QontoClient('org', 'key').getOrganization()).rejects.toBeInstanceOf(RateLimitError)
  })

  it('reports an unreachable Qonto in French', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed: ECONNREFUSED 10.0.0.1'))))
    const error = await new QontoProvider({ login: 'org', secretKey: 'key' }).listAccounts().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect((error as Error).message).toBe('Qonto est injoignable. Réessayez dans quelques minutes.')
  })

  it('refuses incomplete credentials with a French validation error', () => {
    expect(() => new QontoProvider({ login: '', secretKey: '' })).toThrow(ValidationError)
  })
})
