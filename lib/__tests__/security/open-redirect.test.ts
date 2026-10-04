/**
 * Open redirect.
 *
 * The app's own post-login / generic redirect target goes through
 * safeRedirectPath, which must only ever return a same-origin relative path
 * and fall back to '/' for anything that could send a user off-site or run a
 * script. OAuth redirect_uri validation (exact match, no wildcard, http only
 * for loopback/native) is enforced by the Better Auth oauth-provider library;
 * its consent-branding spoof risk is tracked as a delegated finding.
 */

import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { skip } from './findings'

const MALICIOUS = [
  'https://evil.example/phish',
  'http://evil.example',
  '//evil.example', // protocol-relative
  '/\\evil.example', // backslash trick
  '\\\\evil.example',
  'javascript:alert(document.domain)',
  'java\tscript:alert(1)',
  ' javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'https://kledg.invalid.evil.example/x', // not the real origin
  'http://localhost/\r\nSet-Cookie: x=1', // CRLF / header injection
  '/path\u0000/null',
  `/${'a'.repeat(4000)}`, // over-length
]

const SAFE = [
  ['/dashboard', '/dashboard'],
  ['/', '/'],
  ['/entries?companyId=abc#top', '/entries?companyId=abc#top'],
  ['/companies/1/banking', '/companies/1/banking'],
] as const

describe('open redirect: safeRedirectPath', () => {
  it.each(MALICIOUS)('falls back to / for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/')
  })

  it('honours a custom fallback for a malicious value', () => {
    expect(safeRedirectPath('https://evil.example', '/login')).toBe('/login')
  })

  it.each(SAFE)('keeps the same-origin relative path %j', (value, expected) => {
    expect(safeRedirectPath(value)).toBe(expected)
  })

  it('never returns an absolute URL', () => {
    for (const value of [...MALICIOUS, ...SAFE.map(([v]) => v)]) {
      const result = safeRedirectPath(value)
      expect(result.startsWith('/')).toBe(true)
      expect(result.startsWith('//')).toBe(false)
    }
  })

  // OAuth redirect_uri exact-match is enforced by the oauth-provider library.
  // KLEDG-DEL-consent-spoof (fixed): branding needs a verified CIMD client id
  // (components/features/settings/__tests__/assistant-kind.test.ts).
  it('the consent page never brands a self-declared client (KLEDG-DEL-consent-spoof, fixed)', async () => {
    const { assistantKind } = await import('@/components/features/settings/use-assistant-connections')
    const { clientDisplayName } = await import('@/components/features/settings/consent-client')
    const kind = assistantKind('dyn-registered-id', { client_name: 'ChatGPT', client_uri: 'https://chatgpt.com' })
    expect(kind).toBe('other')
    expect(clientDisplayName('ChatGPT', kind)).toBe('Application non vérifiée')
    expect(assistantKind('https://claude.ai.evil.example/oauth/x', { client_name: 'Claude' })).toBe('other')
  })
})
