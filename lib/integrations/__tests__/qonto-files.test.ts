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

// KLEDG-R3-MCP-06: a reader with a smaller budget (an MCP tool) stops at its
// own limit, without downloading up to the provider limit first.
describe('fetchQontoFile with the budget of an assistant', () => {
  const MB = 1024 * 1024
  /** A body of `size` bytes in 1 MB chunks, without content-length, counting the bytes pulled. */
  function streamed(size: number) {
    const pulled = { bytes: 0 }
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled.bytes >= size) return controller.close()
        const chunk = new Uint8Array(Math.min(MB, size - pulled.bytes))
        pulled.bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    return { fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch, pulled }
  }

  it('cuts a 6 MB body at 5 MB with the French message of the assistant files', async () => {
    const { MCP_FILE_BUDGET } = await import('@/lib/mcp/file-result')
    const { fetchImpl, pulled } = streamed(6 * MB)
    await expect(fetchQontoFile('https://files.qonto.com/a.pdf', fetchImpl, MCP_FILE_BUDGET)).rejects.toThrow(/^Fichier trop volumineux pour être transmis à l'assistant/)
    expect(pulled.bytes).toBeLessThanOrEqual(6 * MB)
    expect(pulled.bytes).toBeGreaterThan(5 * MB)
  })

  it('refuses from the declared length before reading, and from the size in the metadata before fetching', async () => {
    const { MCP_FILE_BUDGET } = await import('@/lib/mcp/file-result')
    const { assertDeclaredFileSize } = await import('@/lib/integrations/providers/qonto/files')
    const declared = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': String(5 * MB + 1) } }))
    await expect(fetchQontoFile('https://files.qonto.com/a.pdf', declared as unknown as typeof fetch, MCP_FILE_BUDGET)).rejects.toThrow(/Fichier trop volumineux/)
    expect(() => assertDeclaredFileSize(String(6 * MB), MCP_FILE_BUDGET)).toThrow(/Fichier trop volumineux/)
    expect(() => assertDeclaredFileSize(4 * MB, MCP_FILE_BUDGET)).not.toThrow()
    expect(() => assertDeclaredFileSize(undefined, MCP_FILE_BUDGET)).not.toThrow()
  })

  it('keeps the provider limit for the routes', async () => {
    const { fetchImpl } = streamed(6 * MB)
    const body = await fetchQontoFile('https://files.qonto.com/a.pdf', fetchImpl)
    expect(body.byteLength).toBe(6 * MB)
  })
})
