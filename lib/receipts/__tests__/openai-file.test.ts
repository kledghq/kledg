/**
 * SSRF guard of the ChatGPT file params (lib/receipts/openai-file.ts): only
 * https URLs of OpenAI's file hosts are fetched, through the public-address
 * fetch, never redirected, with a timeout and a byte budget.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@/lib/integrations/public-https-fetch', () => ({
  publicFetch: vi.fn(async (url: string) => {
    network.calls.push(url)
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 })
  }),
}))

import { fetchOpenAiFile, isAllowedOpenAiFileUrl, OPENAI_FILE_MESSAGES } from '../openai-file'

const URL_OK = 'https://files.oaiusercontent.com/file-abc123?se=2026-10-08&sig=xyz'

function stream(chunks: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent++ >= chunks) return controller.close()
      controller.enqueue(new Uint8Array(size))
    },
  })
}

afterEach(() => {
  network.calls.length = 0
})

describe('ChatGPT file URLs (SSRF guard)', () => {
  it('accepts https URLs of the OpenAI file hosts only', () => {
    expect(isAllowedOpenAiFileUrl(URL_OK)).toBe(true)
    expect(isAllowedOpenAiFileUrl('https://sdmntprwestus.oaiusercontent.com/files/x')).toBe(true)
    for (const refused of [
      'http://files.oaiusercontent.com/x',
      'https://files.oaiusercontent.com:8443/x',
      'https://user:pass@files.oaiusercontent.com/x',
      'https://oaiusercontent.com.attacker.example/x',
      'https://attacker-oaiusercontent.com/x',
      'https://169.254.169.254/latest/meta-data',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://localhost/x',
      'file:///etc/passwd',
      'gopher://files.oaiusercontent.com/x',
      'not a url',
    ]) {
      expect(isAllowedOpenAiFileUrl(refused), refused).toBe(false)
    }
  })

  it('lets an operator add exact host names', () => {
    expect(isAllowedOpenAiFileUrl('https://files.example-proxy.test/x', { KLEDG_OPENAI_FILE_HOSTS: 'files.example-proxy.test' })).toBe(true)
    expect(isAllowedOpenAiFileUrl('https://other.example-proxy.test/x', { KLEDG_OPENAI_FILE_HOSTS: 'files.example-proxy.test' })).toBe(false)
  })

  it('refuses before any connection a URL outside the hosts', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchOpenAiFile('https://169.254.169.254/latest/meta-data', { fetchImpl })).rejects.toThrow(OPENAI_FILE_MESSAGES.refused)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(network.calls).toEqual([])
  })

  it('connects through the public-address fetch by default', async () => {
    const bytes = await fetchOpenAiFile(URL_OK)
    expect([...bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0])
    expect(network.calls).toEqual([URL_OK])
  })

  it('never follows a redirect', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }))
    await expect(fetchOpenAiFile(URL_OK, { fetchImpl })).rejects.toThrow(OPENAI_FILE_MESSAGES.unavailable)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual')
  })

  it('refuses a file above the budget from its length, or as soon as the download passes it', async () => {
    const declared = vi.fn(async () => new Response(stream(1, 10), { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } }))
    await expect(fetchOpenAiFile(URL_OK, { fetchImpl: declared })).rejects.toThrow('Mo au plus')
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
    })
    await expect(fetchOpenAiFile(URL_OK, { fetchImpl: async () => new Response(endless, { status: 200 }) })).rejects.toThrow('Mo au plus')
    expect(pulled).toBeLessThanOrEqual(7)
  })

  it('gives up after the timeout, and on an error status', async () => {
    const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
    await expect(fetchOpenAiFile(URL_OK, { fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 10 })).rejects.toThrow(OPENAI_FILE_MESSAGES.unavailable)
    await expect(fetchOpenAiFile(URL_OK, { fetchImpl: async () => new Response('expired', { status: 403 }) })).rejects.toThrow(OPENAI_FILE_MESSAGES.unavailable)
  })
})
