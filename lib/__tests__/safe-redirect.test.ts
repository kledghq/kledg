import { describe, expect, it } from 'vitest'
import { safeRedirectPath } from '@/lib/safe-redirect'

describe('safeRedirectPath', () => {
  it('keeps same-origin relative paths with query and hash', () => {
    expect(safeRedirectPath('/atelier-lumen/entries')).toBe('/atelier-lumen/entries')
    expect(safeRedirectPath('/atelier-lumen/reports/balance-sheet?fy=2026#top')).toBe(
      '/atelier-lumen/reports/balance-sheet?fy=2026#top',
    )
    expect(safeRedirectPath('/')).toBe('/')
  })

  it('falls back for missing values', () => {
    expect(safeRedirectPath(null)).toBe('/')
    expect(safeRedirectPath('')).toBe('/')
    expect(safeRedirectPath(undefined, '/companies')).toBe('/companies')
  })

  it('rejects absolute, protocol-relative and scheme URLs', () => {
    for (const value of [
      'https://evil.example',
      'http://evil.example/path',
      '//evil.example',
      '//evil.example/%2F..',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'data:text/html,hi',
      'evil.example',
      ' /entries',
    ]) {
      expect(safeRedirectPath(value), value).toBe('/')
    }
  })

  it('rejects control characters and backslashes anywhere', () => {
    expect(safeRedirectPath('/\t/evil.example')).toBe('/')
    expect(safeRedirectPath('/\n/evil.example')).toBe('/')
    expect(safeRedirectPath('/a\\b')).toBe('/')
  })

  it('normalizes dot segments without leaving the origin', () => {
    expect(safeRedirectPath('/a/../../b')).toBe('/b')
  })
})
