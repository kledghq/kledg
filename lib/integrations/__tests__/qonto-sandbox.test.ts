import { afterEach, describe, expect, it, vi } from 'vitest'
import { QONTO_SANDBOX_API_URL, getQontoApiUrl, getQontoExtraHeaders } from '../providers/qonto/client-base'
import { QontoClient } from '../providers/qonto/client'

const ENV = ['QONTO_API_URL', 'QONTO_ENVIRONMENT', 'QONTO_STAGING_TOKEN'] as const

afterEach(() => {
  for (const key of ENV) delete process.env[key]
  vi.unstubAllGlobals()
})

describe('Qonto sandbox', () => {
  it('uses production by default and the sandbox with QONTO_ENVIRONMENT=sandbox', () => {
    expect(getQontoApiUrl()).toBe('https://thirdparty.qonto.com/v2')
    process.env.QONTO_ENVIRONMENT = 'sandbox'
    expect(getQontoApiUrl()).toBe(QONTO_SANDBOX_API_URL)
  })

  it('lets QONTO_API_URL win over the environment', () => {
    process.env.QONTO_ENVIRONMENT = 'sandbox'
    process.env.QONTO_API_URL = 'https://example.test/v2/'
    expect(getQontoApiUrl()).toBe('https://example.test/v2')
  })

  it('adds the staging token header only when configured', () => {
    expect(getQontoExtraHeaders()).toEqual({})
    process.env.QONTO_STAGING_TOKEN = ' staging-secret '
    expect(getQontoExtraHeaders()).toEqual({ 'X-Qonto-Staging-Token': 'staging-secret' })
  })

  it('sends the API key and the staging token on API calls', async () => {
    process.env.QONTO_ENVIRONMENT = 'sandbox'
    process.env.QONTO_STAGING_TOKEN = 'staging-secret'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ organization: { slug: 'x', bank_accounts: [] } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QontoClient('login', 'secret')
    await client.getOrganization().catch(() => undefined)
    expect(fetchMock).toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.startsWith(QONTO_SANDBOX_API_URL)).toBe(true)
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('login:secret')
    expect(headers['X-Qonto-Staging-Token']).toBe('staging-secret')
  })
})

describe('Qonto account identifiers', () => {
  it('detects Qonto account ids and masked sandbox IBANs', async () => {
    const { isQontoAccountId, isMaskedIban } = await import('../providers/qonto/account-id')
    expect(isQontoAccountId('019aeeb3-0053-7253-9302-ebc50185aad7')).toBe(true)
    expect(isQontoAccountId('FR7630006000011234567890189')).toBe(false)
    expect(isMaskedIban('FRXXXXXXXXXXXXXXXXXXXXXXXXX')).toBe(true)
    expect(isMaskedIban('FR76 3000 6000 0112 3456 7890 189')).toBe(false)
  })

  it('filters transactions by bank_account_id when given an account id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transactions: [], meta: { next_page: null } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QontoClient('login', 'secret')
    await client.getTransactions('019aeeb3-0053-7253-9302-ebc50185aad7')
    await client.getTransactions('FR7630006000011234567890189')
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown as [string])[0]))
    expect(urls[0]).toContain('bank_account_id=019aeeb3-0053-7253-9302-ebc50185aad7')
    expect(urls[0]).not.toContain('iban=')
    expect(urls[1]).toContain('iban=FR7630006000011234567890189')
  })
})
