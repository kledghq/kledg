/**
 * SSRF: outbound fetches whose destination is, or could be, influenced by a
 * user or a provider payload must never reach loopback, link-local
 * (169.254.169.254), private ranges, or a non-https URL.
 *
 * The real guards tested here are pure (URL allowlists) plus fetchQontoFile,
 * whose fetch is injected so we can assert a refused URL never leaves the
 * process. The address guard (public-https-fetch) is tested with a fake
 * resolver and a local socket that must never see a connection.
 *
 * Map of outbound calls (author recon): all provider hosts come from a
 * constant or an env var; the two surfaces that take a provider-returned URL
 * are the Qonto file proxy (guarded by isAllowedQontoFileUrl) and the company
 * logo handed to react-pdf (guarded by logoError / safeLogoSrc).
 */

import { createServer, type AddressInfo } from 'node:net'
import type { LookupAddress } from 'node:dns'
import { describe, expect, it, vi } from 'vitest'
import { isAllowedQontoFileUrl, fetchQontoFile, MAX_PROVIDER_FILE_BYTES } from '@/lib/integrations/providers/qonto/files'
import { isPublicAddress, publicHttpsFetch, publicOnlyLookup } from '@/lib/integrations/public-https-fetch'
import { logoError, safeLogoSrc } from '@/lib/companies/logo'
import { NEW_FINDINGS } from './findings'

/** Destinations that an SSRF guard must always reject. */
const DANGEROUS_TARGETS = [
  'http://localhost/latest',
  'http://127.0.0.1/',
  'http://[::1]/',
  'https://127.0.0.1/',
  'https://[::1]/',
  'http://169.254.169.254/latest/meta-data/', // AWS/GCP IMDS
  'https://169.254.169.254/latest/meta-data/',
  'http://169.254.170.2/v2/credentials', // ECS task metadata
  'https://10.0.0.5/internal',
  'https://192.168.1.1/',
  'https://172.16.0.1/',
  'https://metadata.google.internal/computeMetadata/v1/',
  'http://thirdparty.qonto.com/v2/x', // right host, wrong scheme
  'ftp://files.qonto.com/x',
  'file:///etc/passwd',
  'gopher://127.0.0.1:6379/_INFO',
]

describe('SSRF: Qonto file URL allowlist', () => {
  it.each(DANGEROUS_TARGETS)('rejects %s', (target) => {
    expect(isAllowedQontoFileUrl(target)).toBe(false)
  })

  it('rejects credentials embedded in the URL (even on an allowed host)', () => {
    expect(isAllowedQontoFileUrl('https://user:pass@files.qonto.com/receipt.pdf')).toBe(false)
    expect(isAllowedQontoFileUrl('https://attacker@attachments.qonto.eu/x')).toBe(false)
  })

  it('rejects a non-default port on an allowed host', () => {
    expect(isAllowedQontoFileUrl('https://files.qonto.com:8443/x')).toBe(false)
  })

  it('rejects look-alike hosts that only end-match via a prefix', () => {
    expect(isAllowedQontoFileUrl('https://qonto.com.attacker.example/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://notqonto.co/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://amazonaws.com.evil.example/x')).toBe(false)
  })

  it('accepts a genuine Qonto / S3 signed URL', () => {
    expect(isAllowedQontoFileUrl('https://attachments.qonto.com/receipt.pdf')).toBe(true)
    expect(isAllowedQontoFileUrl('https://qonto-prod.s3.eu-west-1.amazonaws.com/x?sig=1')).toBe(true)
  })

  it(`[KLEDG-SEC-005] fixed: ${NEW_FINDINGS['KLEDG-SEC-005'].title}`, () => {
    // Only Qonto buckets (Qonto documents pre-signed links on its bucket, e.g.
    // qonto-dev.s3.eu-central-1.amazonaws.com) and Qonto's own domains.
    expect(isAllowedQontoFileUrl('https://attacker-bucket.s3.amazonaws.com/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://ec2-10-0-0-1.compute-1.amazonaws.com/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://s3.eu-central-1.amazonaws.com/attacker/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://qonto-x.s3-website.eu-central-1.amazonaws.com/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://foo.qonto-dev.s3.eu-central-1.amazonaws.com/x')).toBe(false)
    expect(isAllowedQontoFileUrl('https://lambda-url.eu-central-1.on.aws/x')).toBe(false)
    expect(
      isAllowedQontoFileUrl('https://qonto-dev.s3.eu-central-1.amazonaws.com/test/uploads/attachment/x?X-Amz-Expires=1800'),
    ).toBe(true)
    expect(isAllowedQontoFileUrl('https://qonto-files.s3.amazonaws.com/x')).toBe(true)
  })

  it('trusts the configured API origin only (local or simulated API)', () => {
    expect(isAllowedQontoFileUrl('http://localhost:4010/files/1', 'http://localhost:4010/v2')).toBe(true)
    expect(isAllowedQontoFileUrl('http://localhost:4011/files/1', 'http://localhost:4010/v2')).toBe(false)
  })
})

describe('SSRF: provider files are fetched from public addresses only (KLEDG-SEC-005)', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.1',
    '10.1.2.3',
    '172.31.0.1',
    '192.168.0.10',
    '169.254.169.254',
    '169.254.170.2',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    'fe80::1',
    'fe80::1%en0',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '0:0:0:0:0:ffff:a00:1',
    '::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::',
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(['52.219.170.45', '3.5.134.1', '2a05:d014:1::1', '::ffff:52.219.170.45'])('accepts the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  /** Runs the guarded lookup against a fake resolver and returns its outcome. */
  function lookupWith(addresses: LookupAddress[], all = false) {
    const lookup = publicOnlyLookup((_host, _options, callback) => callback(null, addresses))
    return new Promise<{ error: Error | null; result: unknown }>((resolve) => {
      lookup('files.example', { all }, ((error: Error | null, result: unknown) => resolve({ error, result })) as never)
    })
  }

  it('refuses a host when any of its resolved addresses is not public (DNS rebinding included)', async () => {
    const outcome = await lookupWith([
      { address: '52.219.170.45', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    expect(outcome.error?.name).toBe('BlockedAddressError')
    expect((await lookupWith([{ address: '::1', family: 6 }], true)).error?.name).toBe('BlockedAddressError')
    expect((await lookupWith([])).error?.name).toBe('BlockedAddressError')
  })

  it('hands the checked public address to the socket', async () => {
    expect(await lookupWith([{ address: '52.219.170.45', family: 4 }])).toEqual({ error: null, result: '52.219.170.45' })
    const all = await lookupWith([{ address: '52.219.170.45', family: 4 }], true)
    expect(all.result).toEqual([{ address: '52.219.170.45', family: 4 }])
  })

  it('never opens a connection to a host resolving to loopback', async () => {
    let connections = 0
    const server = createServer((socket) => {
      connections++
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const fakeDns = publicOnlyLookup((_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]))
    try {
      await expect(publicHttpsFetch(`https://files.qonto.com:${port}/x`, {}, fakeDns)).rejects.toMatchObject({
        name: 'BlockedAddressError',
      })
      await expect(publicHttpsFetch(`https://127.0.0.1:${port}/x`)).rejects.toMatchObject({ name: 'BlockedAddressError' })
      await expect(publicHttpsFetch(`http://files.qonto.com:${port}/x`)).rejects.toThrow(/https/)
      expect(connections).toBe(0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

describe('SSRF: fetchQontoFile never leaves the process for a refused URL', () => {
  it('throws before calling fetch for every dangerous target', async () => {
    for (const target of DANGEROUS_TARGETS) {
      const fetchImpl = vi.fn()
      await expect(fetchQontoFile(target, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
        name: 'NotFoundError',
      })
      expect(fetchImpl, target).not.toHaveBeenCalled()
    }
  })

  it('fetches an allowed URL exactly once, with redirects refused', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })
    const body = await fetchQontoFile('https://attachments.qonto.com/ok.pdf', fetchImpl as unknown as typeof fetch)
    expect(new Uint8Array(body)).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('refuses an over-size file declared by content-length', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-length': String(MAX_PROVIDER_FILE_BYTES + 1) },
        }),
    )
    await expect(
      fetchQontoFile('https://attachments.qonto.com/big.pdf', fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'ExternalServiceError' })
  })

  it(`[KLEDG-SEC-006] fixed: ${NEW_FINDINGS['KLEDG-SEC-006'].title}`, async () => {
    // With no content-length the body is read with a byte budget.
    const huge = new Uint8Array(MAX_PROVIDER_FILE_BYTES + 1024)
    const fetchImpl = vi.fn(async () => new Response(huge, { status: 200 }))
    await expect(
      fetchQontoFile('https://attachments.qonto.com/stream', fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'ExternalServiceError' })
  })

  it('stops reading an endless body just past the limit and cancels the stream', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let pulled = 0
    let cancelled = false
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchImpl = vi.fn(async () => new Response(endless, { status: 200 }))
    await expect(
      fetchQontoFile('https://attachments.qonto.com/endless', fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'ExternalServiceError' })
    expect(cancelled).toBe(true)
    // 25 MiB in 1 MiB chunks: the read stops at the first chunk past the limit (plus the stream's read-ahead)
    expect(pulled).toBeLessThanOrEqual(MAX_PROVIDER_FILE_BYTES / chunk.byteLength + 3)
  })

  it('refuses a body longer than its declared content-length allows', async () => {
    const body = new Uint8Array(MAX_PROVIDER_FILE_BYTES + 1)
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-length': '10' } }))
    await expect(
      fetchQontoFile('https://attachments.qonto.com/liar', fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ name: 'ExternalServiceError' })
  })

  it('returns a body under the limit intact', async () => {
    const body = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251)
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }))
    const result = await fetchQontoFile('https://attachments.qonto.com/ok', fetchImpl as unknown as typeof fetch)
    expect(new Uint8Array(result)).toEqual(body)
  })
})

describe('SSRF: company logo handed to the server-side PDF renderer', () => {
  it.each([
    'http://localhost/logo.png',
    'https://169.254.169.254/logo.png',
    'https://10.0.0.1/logo.png',
    'http://files.example.com/logo.png',
    'file:///etc/passwd',
    'https://user:pass@cdn.example.com/logo.png',
    'https://cdn.example.com:8443/logo.png',
  ])('rejects %s', (value) => {
    expect(logoError(value)).not.toBeNull()
    expect(safeLogoSrc(value)).toBeNull()
  })

  it('accepts an inline data: image', () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    expect(logoError(png)).toBeNull()
    expect(safeLogoSrc(png)).toBe(png)
  })

  it('rejects an https host that is not on LOGO_ALLOWED_HOSTS (empty by default)', () => {
    expect(logoError('https://cdn.example.com/logo.png')).not.toBeNull()
  })
})
