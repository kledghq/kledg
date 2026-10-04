/**
 * Stored XSS: user-controlled text rendered in the UI must never produce a
 * script execution vector. React escapes text by default and the app has a
 * single dangerouslySetInnerHTML (a static chart <style>), so the real risks
 * are the markdown-ish renderers and any href/src built from data.
 *
 * This renders the release-notes viewer (the one place that turns external
 * text into a tree of links) with injection payloads and asserts no <script>,
 * no injected <img>, and no javascript:/data: href. It also pins the pure URL
 * and client-name guards used around the UI.
 */

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ReleaseNotes } from '@/components/features/updates/release-notes'
import { safeHref } from '@/lib/updates/release-notes'
import { safeLogoUri, clientDisplayName } from '@/components/features/settings/consent-client'

const PAYLOADS = [
  '<script>alert(document.domain)</script>',
  '<img src=x onerror=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '[piège](javascript:alert(1))',
  '[piège](data:text/html,<script>alert(1)</script>)',
  '![x](javascript:alert(1))',
  '# <script>alert(1)</script>\n\nTexte **gras** et [ok](https://example.com).',
]

describe('XSS: release-notes renderer neutralises injected markup and links', () => {
  it.each(PAYLOADS)('renders %j without a script/img/javascript sink', (markdown) => {
    const { container, unmount } = render(<ReleaseNotes markdown={markdown} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    for (const a of Array.from(container.querySelectorAll('a'))) {
      const href = a.getAttribute('href') ?? ''
      expect(href.startsWith('https://') || href === '').toBe(true)
      expect(href.toLowerCase()).not.toContain('javascript:')
      expect(href.toLowerCase()).not.toContain('data:')
    }
    unmount()
  })

  it('keeps a legitimate https link', () => {
    const { container, unmount } = render(<ReleaseNotes markdown={'[ok](https://example.com/notes)'} />)
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://example.com/notes')
    unmount()
  })
})

describe('XSS: URL and client-name guards', () => {
  it('safeHref keeps only https', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('http://example.com')).toBeNull()
    expect(safeHref('not a url')).toBeNull()
  })

  it('safeLogoUri rejects non-https, svg and non-identified clients', () => {
    const cimd = 'https://assistant.example/.well-known/oauth-client'
    expect(safeLogoUri('https://cdn.example/logo.png', cimd)).toBe('https://cdn.example/logo.png')
    expect(safeLogoUri('http://cdn.example/logo.png', cimd)).toBeNull()
    expect(safeLogoUri('javascript:alert(1)', cimd)).toBeNull()
    expect(safeLogoUri('https://cdn.example/logo.svg', cimd)).toBeNull()
    // A client not identified by an https client_id (dynamic registration) gets no logo.
    expect(safeLogoUri('https://cdn.example/logo.png', null)).toBeNull()
  })

  it('clientDisplayName returns a plain string (escaped as text by React)', () => {
    // A CIMD client (identified by its domain) shows its declared name as is; React escapes it at render.
    const name = clientDisplayName('<script>alert(1)</script>', 'other', 'tool.example')
    expect(name).toContain('<script>') // not pre-escaped
    // An unverified (dynamically registered) client never shows its declared name as its identity.
    expect(clientDisplayName('<script>alert(1)</script>', 'other')).toBe('Application non vérifiée')
  })
})
