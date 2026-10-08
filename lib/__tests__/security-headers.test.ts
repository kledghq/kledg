/**
 * Security headers: static ones for every response (next.config.ts) and a
 * nonce-based Content-Security-Policy for pages (proxy.ts).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import nextConfig from '@/next.config'
import { proxy } from '@/proxy'
import { buildContentSecurityPolicy } from '@/lib/security-headers'

type Rule = { source: string; headers: Array<{ key: string; value: string }> }

async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = ((await nextConfig.headers?.()) ?? []) as Rule[]
  const result = new Map<string, string>()
  for (const rule of rules) {
    const pattern = new RegExp(
      '^' + rule.source.replace(/\/:path\*/g, '(?:/.*)?').replace(/:path\*/g, '.*') + '$',
    )
    if (pattern.test(path)) for (const h of rule.headers) result.set(h.key.toLowerCase(), h.value)
  }
  return result
}

describe('static security headers', () => {
  it('protects every response', async () => {
    const h = await headersFor('/companies')
    expect(h.get('x-frame-options')).toBe('DENY')
    expect(h.get('x-content-type-options')).toBe('nosniff')
    // [KLEDG-R3-CLOUD-03] the origin only, same-origin navigations included: no company slug in a referrer.
    expect(h.get('referrer-policy')).toBe('strict-origin')
    expect(h.get('strict-transport-security')).toMatch(/max-age=\d{8}/)
    expect(h.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(h.get('permissions-policy')).toContain('camera=()')
  })

  it('locks API responses down and lets only this instance frame its file proxies', async () => {
    expect((await headersFor('/api/entries')).get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    const proxied = await headersFor('/api/qonto/statements/abc/proxy')
    expect(proxied.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(proxied.get('content-security-policy')).toBe("frame-ancestors 'self'")
  })
})

describe('page Content-Security-Policy', () => {
  it('allows scripts by nonce only, and no framing', () => {
    const csp = buildContentSecurityPolicy('abc123', { development: false })
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it('is set by the proxy on pages, with a fresh nonce handed to the render', async () => {
    const first = await proxy(new NextRequest('http://localhost/login'))
    const second = await proxy(new NextRequest('http://localhost/login'))
    const csp = first.headers.get('content-security-policy') ?? ''
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy()
    expect(second.headers.get('content-security-policy')).not.toBe(csp)
    // Next reads the nonce from the request headers the proxy forwards.
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(csp)
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
  })
})

describe('installable app (PWA) files', () => {
  const ROOT = path.resolve(__dirname, '../..')

  it('are served without a session and without the page CSP', async () => {
    for (const file of ['/manifest.webmanifest', '/sw.js', '/offline.html']) {
      const response = await proxy(new NextRequest(`http://localhost${file}`))
      expect(response.headers.get('location'), file).toBeNull()
      expect(response.status, file).toBe(200)
      expect(response.headers.get('content-security-policy'), file).toBeNull()
    }
    // Pages around them still redirect to the sign-in page.
    const page = await proxy(new NextRequest('http://localhost/acme/entries'))
    expect(page.headers.get('location')).toContain('/login')
  })

  it('give the service worker a same-origin script policy and no HTTP caching', async () => {
    const h = await headersFor('/sw.js')
    expect(h.get('content-security-policy')).toBe("default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'")
    expect(h.get('cache-control')).toContain('no-cache')
  })

  it('let the offline page run no script at all', async () => {
    const csp = (await headersFor('/offline.html')).get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('script-src')
    const html = readFileSync(path.join(ROOT, 'public/offline.html'), 'utf8')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).toContain('Vous êtes hors ligne')
  })

  it('add no inline script to pages (the page CSP allows only nonce scripts)', () => {
    const files = ['app/layout.tsx', 'app/manifest.ts', 'components/pwa/pwa-provider.tsx', 'components/pwa/install.ts']
    for (const file of files) {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).not.toMatch(/<script|next\/script|dangerouslySetInnerHTML/)
    }
  })
})
