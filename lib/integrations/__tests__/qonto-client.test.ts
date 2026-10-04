/**
 * Qonto Business API client (lib/integrations/providers/qonto/client.ts and
 * its modules: transactions, attachments, statements, client-base) with a
 * stubbed fetch (no network): query parameters, pagination, the receipts of
 * every account, and error mapping to French messages
 * (lib/banking/errors.ts) with Qonto's detail and the key kept out of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { logger } from '@/lib/logger'
import { QontoClient } from '@/lib/integrations/providers/qonto/client'
import { AccountingError, ExternalServiceError, RateLimitError } from '@/lib/accounting/errors'
import { BankAuthorizationError } from '@/lib/banking/errors'

const API = 'https://qonto.test/v2'
const SECRET = 'qonto-secret-key-0123'
const IBAN = 'FR7616958000016543210987654'
const ACCOUNT_ID = '5f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const calls: Array<{ url: URL; init?: RequestInit }> = []
function stub(answer: (url: URL, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      return answer(url, init)
    }),
  )
}

const meta = (current: number, next: number | null) => ({ current_page: current, next_page: next, prev_page: null, total_pages: 2, total_count: 3, per_page: 100 })
const tx = (id: string, attachmentIds: string[] = [], over: Record<string, unknown> = {}) => ({
  id: `uuid-${id}`,
  transaction_id: id,
  amount: 12.5,
  label: `Achat ${id}`,
  settled_at: '2026-09-02T10:00:00.000Z',
  attachment_ids: attachmentIds,
  ...over,
})
const attachment = (id: string) => ({ id, file_name: `${id}.pdf`, file_size: 100, file_content_type: 'application/pdf', file_url: `https://files.qonto.com/${id}`, created_at: '', updated_at: '' })

const client = () => new QontoClient('acme', SECRET)

beforeEach(() => {
  process.env.QONTO_API_URL = `${API}/`
  calls.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.QONTO_API_URL
})

describe('requests', () => {
  it('sends the API key as login:secret with a JSON content type to the configured host, without redirects', async () => {
    stub(() => json({ organization: { bank_accounts: [] } }))
    expect(await client().getAccounts()).toEqual([])
    const [{ url, init }] = calls
    expect(url.toString()).toBe(`${API}/organization`)
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`acme:${SECRET}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('asks every status by IBAN, with the day bounds of since and until in ISO 8601', async () => {
    stub(() => json({ transactions: [], meta: meta(1, null) }))
    await client().getTransactions(IBAN, { currentPage: 2, perPage: 50, since: '2026-09-01', until: '2026-09-30' })
    const params = calls[0].url.searchParams
    expect(params.get('iban')).toBe(IBAN)
    expect(params.get('bank_account_id')).toBeNull()
    expect(params.get('page')).toBe('2')
    expect(params.get('per_page')).toBe('50')
    expect(params.getAll('status[]')).toEqual(['completed', 'pending', 'declined'])
    expect(params.get('settled_at_from')).toBe('2026-09-01T00:00:00.000Z')
    expect(params.get('settled_at_to')).toBe('2026-09-30T23:59:59.000Z')
  })

  it('lets explicit settlement bounds win over since and until', async () => {
    stub(() => json({ transactions: [], meta: meta(1, null) }))
    await new QontoClient('acme', SECRET).getTransactions(ACCOUNT_ID, {
      since: '2026-01-01',
      until: '2026-01-31',
      settledAtFrom: '2026-09-01T08:00:00Z',
      settledAtTo: '2026-09-02T08:00:00Z',
    })
    const params = calls[0].url.searchParams
    expect(params.get('bank_account_id')).toBe(ACCOUNT_ID)
    expect(params.getAll('settled_at_from')).toEqual(['2026-09-01T08:00:00Z'])
    expect(params.getAll('settled_at_to')).toEqual(['2026-09-02T08:00:00Z'])
  })

  it('reads every transaction page until next_page is null, since a day', async () => {
    stub((url) => {
      const page = url.searchParams.get('page')
      return page === '1' ? json({ transactions: [tx('t1'), tx('t2')], meta: meta(1, 2) }) : json({ transactions: [tx('t3')], meta: meta(2, null) })
    })
    const all = await client().getAllTransactions(IBAN, '2026-09-01')
    expect(all.map((t) => t.transaction_id)).toEqual(['t1', 't2', 't3'])
    expect(calls.map((c) => [c.url.searchParams.get('page'), c.url.searchParams.get('per_page'), c.url.searchParams.get('settled_at_from')])).toEqual([
      ['1', '100', '2026-09-01T00:00:00Z'],
      ['2', '100', '2026-09-01T00:00:00Z'],
    ])
  })

  it('keeps an ISO since as is', async () => {
    stub(() => json({ transactions: [], meta: meta(1, null) }))
    await client().getAllTransactions(IBAN, '2026-09-01T12:00:00Z')
    expect(calls[0].url.searchParams.get('settled_at_from')).toBe('2026-09-01T12:00:00Z')
  })

  it('encodes ids as one path segment', async () => {
    stub(() => json({ attachments: [], meta: {} }))
    await client().listTransactionAttachments('../organization?x=1', { page: 3, perPage: 20 })
    expect(calls[0].url.pathname).toBe('/v2/transactions/..%2Forganization%3Fx%3D1/attachments')
    expect(calls[0].url.searchParams.get('page')).toBe('3')
    expect(calls[0].url.searchParams.get('per_page')).toBe('20')
    expect(calls[0].url.searchParams.get('x')).toBeNull()

    await client().getAttachment('a/b')
    expect(calls[1].url.pathname).toBe('/v2/attachments/a%2Fb')
  })

  it('lists attachments without a query string when no page is asked', async () => {
    stub(() => json({ attachments: [], meta: {} }))
    await client().listTransactionAttachments('uuid-1')
    expect(calls[0].url.toString()).toBe(`${API}/transactions/uuid-1/attachments`)
  })
})

describe('statements', () => {
  it('sends the filters of a statements page', async () => {
    stub(() => json({ statements: [], meta: meta(1, null) }))
    await client().getStatements({
      page: 2,
      perPage: 10,
      sortBy: 'period:desc',
      bankAccountIds: ['acc-1', 'acc-2'],
      ibans: [IBAN],
      periodFrom: '01-2026',
      periodTo: '09-2026',
    })
    const params = calls[0].url.searchParams
    expect(Object.fromEntries([...params.keys()].map((k) => [k, params.getAll(k)]))).toEqual({
      page: ['2'],
      per_page: ['10'],
      sort_by: ['period:desc'],
      'bank_account_ids[]': ['acc-1', 'acc-2'],
      'ibans[]': [IBAN],
      period_from: ['01-2026'],
      period_to: ['09-2026'],
    })
    await client().getStatements()
    expect(calls[1].url.toString()).toBe(`${API}/statements`)
  })

  it('reads every statements page with the same filters', async () => {
    stub((url) =>
      url.searchParams.get('page') === '1'
        ? json({ statements: [{ id: 's-1' }, { id: 's-2' }], meta: meta(1, 2) })
        : json({ statements: [{ id: 's-3' }], meta: meta(2, null) }),
    )
    const all = await client().getAllStatements({ sortBy: 'period:asc', ibans: [IBAN] })
    expect(all.map((s) => s.id)).toEqual(['s-1', 's-2', 's-3'])
    expect(calls.map((c) => [c.url.searchParams.get('page'), c.url.searchParams.get('sort_by'), c.url.searchParams.get('ibans[]')])).toEqual([
      ['1', 'period:asc', IBAN],
      ['2', 'period:asc', IBAN],
    ])
  })
})

describe('receipts of transactions', () => {
  it('collects the receipts of every account, skipping the ones Qonto cannot return', async () => {
    stub((url) => {
      if (url.pathname.endsWith('/organization')) {
        return json({ organization: { bank_accounts: [{ id: 'acc-1', iban: IBAN }, { id: 'acc-2', iban: 'FR7630004000031234567890143' }] } })
      }
      if (url.pathname.endsWith('/transactions')) {
        return url.searchParams.get('iban') === IBAN
          ? json({ transactions: [tx('t1', ['att-1', 'att-missing']), tx('t2')], meta: meta(1, null) })
          : json({ transactions: [tx('t3', ['att-3'], { amount: 99.9, settled_at: '2026-09-05T00:00:00.000Z' })], meta: meta(1, null) })
      }
      if (url.pathname.endsWith('/attachments/att-missing')) return json({ errors: [{ detail: 'not found' }] }, 404)
      const id = url.pathname.split('/').pop()!
      return json(attachment(id))
    })
    const all = await client().getAllAttachments('2026-09-01')
    expect(all.map((a) => [a.id, a.transaction_id, a.transaction_uuid, a.transaction_label, a.transaction_date, a.transaction_amount])).toEqual([
      ['att-1', 't1', 'uuid-t1', 'Achat t1', '2026-09-02T10:00:00.000Z', 12.5],
      ['att-3', 't3', 'uuid-t3', 'Achat t3', '2026-09-05T00:00:00.000Z', 99.9],
    ])
  })

  it('returns the receipts of one transaction from the first page of its account (deprecated path)', async () => {
    stub((url) => {
      if (url.pathname.endsWith('/transactions')) return json({ transactions: [tx('t1', ['att-1', 'att-gone']), tx('t2')], meta: meta(1, null) })
      if (url.pathname.endsWith('/attachments/att-gone')) return json({}, 500)
      return json(attachment(url.pathname.split('/').pop()!))
    })
    expect((await client().getTransactionAttachments('t1', IBAN)).map((a) => a.id)).toEqual(['att-1'])
    expect(await client().getTransactionAttachments('t2', IBAN)).toEqual([])
    expect(await client().getTransactionAttachments('unknown', IBAN)).toEqual([])
    expect(calls[0].url.searchParams.get('per_page')).toBe('100')
  })
})

describe('errors', () => {
  async function failure(response: () => Response): Promise<AccountingError> {
    stub(() => response())
    const error = await client()
      .getTransactions(IBAN)
      .then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(AccountingError)
    return error as AccountingError
  }

  it('maps 401 to the Qonto access advice and logs Qonto\'s detail without the IBAN of the query', async () => {
    const error = await failure(() => json({ errors: [{ detail: 'Invalid key' }, { title: 'Forbidden org' }] }, 401))
    expect(error).toBeInstanceOf(BankAuthorizationError)
    expect(error.message).toBe(
      "Qonto refuse l'accès : vérifiez l'identifiant et la clé secrète de l'API, puis mettez-les à jour depuis la page Banque.",
    )
    expect(error.message).not.toContain(SECRET)
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith('[Bank] Qonto API error', {
      status: 401,
      code: undefined,
      operation: 'GET /transactions',
      detail: 'Invalid key · Forbidden org',
    })
  })

  it('maps 429 to a rate limit without logging, 404 and 5xx to their French messages', async () => {
    const limited = await failure(() => json({ message: 'slow down' }, 429))
    expect(limited).toBeInstanceOf(RateLimitError)
    expect(limited.message).toBe('Qonto limite le nombre de requêtes : réessayez dans quelques minutes.')
    expect(logger.error).not.toHaveBeenCalled()

    expect((await failure(() => json({ message: 'no such account' }, 404))).message).toBe(
      "Qonto ne trouve pas l'élément demandé : actualisez la page puis réessayez.",
    )
    expect((await failure(() => new Response('<html>Bad gateway</html>', { status: 502 }))).message).toBe(
      'Qonto est indisponible pour le moment. Réessayez dans quelques minutes.',
    )
    expect(vi.mocked(logger.error).mock.calls.map((c) => (c[1] as { detail: string }).detail)).toEqual(['no such account', '<html>Bad gateway</html>'])
  })

  it('reports another refusal with its status, and reads error.message bodies for the log', async () => {
    const error = await failure(() => json({ error: { message: 'iban is invalid' } }, 422))
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect(error.message).toBe('Qonto a refusé la demande (erreur 422). Réessayez, ou vérifiez la connexion depuis la page Banque.')
    expect((vi.mocked(logger.error).mock.calls[0][1] as { detail: string }).detail).toBe('iban is invalid')
  })

  it('maps a network failure and a timeout to French messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('getaddrinfo ENOTFOUND qonto.test'))))
    await expect(client().getAccounts()).rejects.toThrow(new ExternalServiceError('Qonto est injoignable. Réessayez dans quelques minutes.'))

    const timeout = new Error('The operation timed out')
    timeout.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(timeout)))
    await expect(client().getStatement('s-1')).rejects.toThrow(new ExternalServiceError('Qonto ne répond pas. Réessayez dans quelques minutes.'))
  })
})
