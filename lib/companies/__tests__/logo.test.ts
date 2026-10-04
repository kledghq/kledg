import { afterEach, describe, expect, it } from 'vitest'
import { logoError, parseLogoInput, safeLogoSrc } from '../logo'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

afterEach(() => {
  delete process.env.LOGO_ALLOWED_HOSTS
})

describe('company logo validation', () => {
  it('accepts inline raster images', () => {
    expect(logoError(PNG)).toBeNull()
    expect(logoError('data:image/jpeg;base64,/9j/4AAQ')).toBeNull()
    expect(logoError('data:image/webp;base64,UklGRg==')).toBeNull()
  })

  it('rejects SVG, HTML and malformed data URLs', () => {
    expect(logoError('data:image/svg+xml;base64,PHN2Zz4=')).not.toBeNull()
    expect(logoError('data:text/html;base64,PGgxPg==')).not.toBeNull()
    expect(logoError('data:image/png,<svg onload=alert(1)>')).not.toBeNull()
  })

  it('rejects oversized data URLs', () => {
    expect(logoError(`data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`)).toMatch(/volumineux/)
  })

  it('rejects URLs that would make the server fetch internal resources', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'https://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      '/etc/passwd',
      '../../.env',
      'https://localhost/logo.png',
      'https://evil.example/logo.png',
      'gopher://internal:70/',
    ]) {
      expect(logoError(url), url).not.toBeNull()
    }
  })

  it('accepts https URLs on the allowlist only', () => {
    process.env.LOGO_ALLOWED_HOSTS = 'cdn.example.com, images.example.org'
    expect(logoError('https://cdn.example.com/logo.png')).toBeNull()
    expect(logoError('https://CDN.example.com/logo.png')).toBeNull()
    expect(logoError('http://cdn.example.com/logo.png')).not.toBeNull()
    expect(logoError('https://cdn.example.com:8443/logo.png')).not.toBeNull()
    expect(logoError('https://user:pw@cdn.example.com/logo.png')).not.toBeNull()
    expect(logoError('https://cdn.example.com.evil.net/logo.png')).not.toBeNull()
  })

  it('parses request input: unchanged, cleared, or validated', () => {
    expect(parseLogoInput(undefined)).toBeUndefined()
    expect(parseLogoInput(null)).toBeNull()
    expect(parseLogoInput('')).toBeNull()
    expect(parseLogoInput(PNG)).toBe(PNG)
    expect(() => parseLogoInput('http://169.254.169.254/')).toThrow()
    expect(() => parseLogoInput(42)).toThrow()
  })

  it('drops unsafe stored logos at render time', () => {
    expect(safeLogoSrc(PNG)).toBe(PNG)
    expect(safeLogoSrc('http://127.0.0.1:5432/')).toBeNull()
    expect(safeLogoSrc(null)).toBeNull()
  })
})
