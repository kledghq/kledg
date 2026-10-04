import { describe, expect, it } from 'vitest'

import { bankAccountName, bankAccountSubtitle, formatFileSize, isTechnicalName, plural, statementMonth } from '../format'

describe('bank account names', () => {
  const qonto = { name: 'atelier-lumen-compte-principal', displayName: null, iban: 'FR76 1695 8000 0112 3456 7890 143' }

  it('recognizes provider slugs, not real names', () => {
    expect(isTechnicalName('atelier-lumen-compte-principal')).toBe(true)
    expect(isTechnicalName('Compte courant')).toBe(false)
    expect(isTechnicalName('Compte-courant')).toBe(false)
    expect(isTechnicalName('principal')).toBe(false)
  })

  it('prefers the name chosen in Kledg', () => {
    expect(bankAccountName({ ...qonto, displayName: '  Compte principal ' })).toBe('Compte principal')
  })

  it('never shows a technical slug: falls back to the end of the IBAN', () => {
    expect(bankAccountName(qonto)).toBe('Compte •••• 0143')
    expect(bankAccountSubtitle(qonto)).toBeNull()
  })

  it('keeps a real bank name and shows it under a chosen name', () => {
    const account = { name: 'Compte courant', displayName: 'Banque principale', iban: null }
    expect(bankAccountName(account)).toBe('Banque principale')
    expect(bankAccountSubtitle(account)).toBe('Compte courant')
    expect(bankAccountSubtitle({ ...account, displayName: null })).toBeNull()
  })

  it('never shows a slug, even without an IBAN', () => {
    expect(bankAccountName({ name: 'atelier-lumen-compte-principal' })).toBe('Compte bancaire')
    expect(bankAccountName({ name: 'atelier-lumen-compte-principal', iban: '' })).toBe('Compte bancaire')
  })
})

describe('plural', () => {
  it('uses the singular for 0 and 1, as in French', () => {
    expect(plural(0, 'relevé')).toBe('0 relevé')
    expect(plural(1, 'relevé')).toBe('1 relevé')
    expect(plural(3, 'relevé')).toBe('3 relevés')
    expect(plural(2, 'doublon probable', 'doublons probables')).toBe('2 doublons probables')
  })
})

describe('formatFileSize', () => {
  it('uses French units and decimal commas', () => {
    expect(formatFileSize(820)).toBe('820 o')
    expect(formatFileSize(12_700)).toBe('12,4 Ko')
    expect(formatFileSize(1_258_291)).toBe('1,2 Mo')
  })
})

describe('statementMonth', () => {
  it('reads a Qonto period as the first day of the month in UTC', () => {
    expect(statementMonth('08-2026')?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(statementMonth('13-2026')).toBeNull()
    expect(statementMonth('2026-08')).toBeNull()
  })
})
