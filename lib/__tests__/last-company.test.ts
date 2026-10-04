/**
 * The "last company" cookie (lib/last-company.ts): what the settings layout
 * accepts from it, and the cookie the company sidebar writes.
 */

import { describe, expect, it } from 'vitest'
import { LAST_COMPANY_COOKIE, lastCompanyCookie, parseLastCompany } from '@/lib/last-company'

describe('parseLastCompany', () => {
  it('accepts a company slug', () => {
    expect(parseLastCompany('atelier-alpha')).toBe('atelier-alpha')
    expect(parseLastCompany('cm0abc123')).toBe('cm0abc123')
    expect(parseLastCompany('a'.repeat(80))).toBe('a'.repeat(80))
  })

  it('ignores a missing, empty, too long or foreign value', () => {
    for (const value of [undefined, null, '', 'a'.repeat(81), 'Atelier', 'atelier alpha', '../admin', 'a%2Fb', '<script>', 'atelier_alpha']) {
      expect(parseLastCompany(value), String(value)).toBeNull()
    }
  })
})

describe('lastCompanyCookie', () => {
  it('remembers the slug for a year on the whole site, SameSite=Lax', () => {
    expect(LAST_COMPANY_COOKIE).toBe('kledg_last_company')
    expect(lastCompanyCookie('atelier-alpha')).toBe('kledg_last_company=atelier-alpha; path=/; max-age=31536000; samesite=lax')
  })

  it('encodes a value that would add a cookie attribute', () => {
    expect(lastCompanyCookie('a; domain=evil.example')).toBe(
      'kledg_last_company=a%3B%20domain%3Devil.example; path=/; max-age=31536000; samesite=lax',
    )
  })

  it('round-trips through parseLastCompany', () => {
    const cookie = lastCompanyCookie('bureau-beta-2')
    const value = decodeURIComponent(cookie.split(';')[0].split('=')[1])
    expect(parseLastCompany(value)).toBe('bureau-beta-2')
  })
})
