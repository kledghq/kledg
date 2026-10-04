import { describe, expect, it, vi } from 'vitest'
import { ExternalServiceError, NotFoundError } from '@/lib/accounting/errors'
import { fetchQontoFile, isAllowedQontoFileUrl, MAX_PROVIDER_FILE_BYTES } from '@/lib/integrations/providers/qonto/files'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const API = 'https://thirdparty.qonto.com/v2'

describe('isAllowedQontoFileUrl (SSRF guard of the receipt and statement proxies)', () => {
  it('accepts the hosts Qonto serves signed files from', () => {
    expect(isAllowedQontoFileUrl('https://qonto-attachments.s3.eu-central-1.amazonaws.com/a/b.pdf?X-Amz-Signature=1', API)).toBe(true)
    expect(isAllowedQontoFileUrl('https://files.qonto.com/statement.pdf', API)).toBe(true)
    expect(isAllowedQontoFileUrl('https://thirdparty-sandbox.staging.qonto.co/v2/file', API)).toBe(true)
  })

  it('refuses internal addresses, other hosts, other schemes and ports, and credentials in the URL', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://evil.example/receipt.pdf',
      'https://amazonaws.com.evil.example/x',
      'https://qonto.com.evil.example/x',
      'http://files.qonto.com/x',
      'https://files.qonto.com:8443/x',
      'https://user:pass@files.qonto.com/x',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isAllowedQontoFileUrl(url, API), url).toBe(false)
    }
  })

  it('accepts the origin of a configured local Qonto API (simulator)', () => {
    expect(isAllowedQontoFileUrl('http://localhost:4010/files/1.pdf', 'http://localhost:4010/v2')).toBe(true)
    expect(isAllowedQontoFileUrl('http://localhost:4011/files/1.pdf', 'http://localhost:4010/v2')).toBe(false)
  })
})

describe('fetchQontoFile', () => {
  it('never calls fetch for a refused URL', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchQontoFile('http://169.254.169.254/latest/meta-data/', fetchImpl)).rejects.toBeInstanceOf(NotFoundError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('downloads without following redirects and with a timeout', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.7', { status: 200 }))
    const body = await fetchQontoFile('https://files.qonto.com/statement.pdf', fetchImpl as unknown as typeof fetch)
    expect(new TextDecoder().decode(body)).toBe('%PDF-1.7')
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports a failed or oversized download in French', async () => {
    const failing = vi.fn(async () => new Response('denied', { status: 403 }))
    await expect(fetchQontoFile('https://files.qonto.com/a.pdf', failing as unknown as typeof fetch)).rejects.toBeInstanceOf(ExternalServiceError)
    const huge = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(MAX_PROVIDER_FILE_BYTES + 1) } }))
    await expect(fetchQontoFile('https://files.qonto.com/a.pdf', huge as unknown as typeof fetch)).rejects.toThrow('25 Mo')
  })
})
