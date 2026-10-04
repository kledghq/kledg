/**
 * Lettering rules (lib/lettering/rules.ts): which accounts are lettered
 * (PCG art. 944-40 and 944-46, comptes de tiers), the code sequence written
 * to FEC EcritureLet (LPF art. A47 A-1) and the balanced-only selection.
 */

import { describe, expect, it } from 'vitest'
import { checkSelection, compareCodes, formatEuros, isLetterableAccount, isSequenceCode, nextLetteringCode, successorCode } from '../rules'

describe('letterable accounts', () => {
  it.each(['411000', '4111DUPONT', '401000', '4081', '4181', '409', '419', '421', '425', '455', '4551', '467000', '471', '475'])('%s can be lettered', (code) => {
    expect(isLetterableAccount(code)).toBe(true)
  })

  it.each(['512000', '445660', '44571', '431', '606100', '706000', '101300', '42', '486'])('%s cannot', (code) => {
    expect(isLetterableAccount(code)).toBe(false)
  })
})

describe('lettering codes', () => {
  it('starts at AA and follows AB, AC... per account', () => {
    expect(nextLetteringCode([])).toBe('AA')
    expect(nextLetteringCode(['AA'])).toBe('AB')
    expect(nextLetteringCode(['AA', 'AB', 'AC'])).toBe('AD')
  })

  it('carries over: AZ then BA, ZZ then AAA, AZZ then BAA', () => {
    expect(successorCode('AZ')).toBe('BA')
    expect(successorCode('ZZ')).toBe('AAA')
    expect(successorCode('AZZ')).toBe('BAA')
    expect(successorCode('ZZZ')).toBe('AAAA')
  })

  it('continues after the greatest code, shorter codes first', () => {
    expect(nextLetteringCode(['AB', 'ZZ', 'AA'])).toBe('AAA')
    expect(nextLetteringCode(['AAB', 'ZZ'])).toBe('AAC')
    expect(compareCodes('ZZ', 'AAA')).toBeLessThan(0)
    expect(compareCodes('BA', 'AZ')).toBeGreaterThan(0)
  })

  it('reuses a code freed by unlettering only when it was the last one', () => {
    // AB unlettered while AC exists: the sequence goes on at AD
    expect(nextLetteringCode(['AA', 'AC'])).toBe('AD')
    // AC unlettered and nothing after it: AC is free again
    expect(nextLetteringCode(['AA', 'AB'])).toBe('AC')
  })

  it('ignores imported codes outside the sequence (lowercase partial codes, digits, single letters)', () => {
    expect(isSequenceCode('A')).toBe(false)
    expect(isSequenceCode('ab')).toBe(false)
    expect(isSequenceCode('A1')).toBe(false)
    expect(nextLetteringCode(['A', 'b', '12', null, undefined, 'AC'])).toBe('AD')
    expect(nextLetteringCode(['A', 'zz'])).toBe('AA')
  })
})

describe('selection check (no partial lettering)', () => {
  const invoice = { id: 'f', debitCents: 120_000, creditCents: 0, auxiliaryAccountNumber: 'C001' }
  const payment = { id: 'p', debitCents: 0, creditCents: 120_000, auxiliaryAccountNumber: 'C001' }

  it('accepts lines whose debits equal credits to the cent', () => {
    expect(checkSelection([invoice, payment])).toEqual({ debitCents: 120_000, creditCents: 120_000, balanceCents: 0, errors: [] })
  })

  it('accepts several instalments for one invoice', () => {
    const half = { ...payment, creditCents: 60_000 }
    expect(checkSelection([invoice, { ...half, id: 'p1' }, { ...half, id: 'p2' }]).errors).toEqual([])
  })

  it('refuses an unbalanced selection with the gap, in French', () => {
    const check = checkSelection([invoice, { ...payment, creditCents: 119_999 }])
    expect(check.balanceCents).toBe(1)
    expect(check.errors).toHaveLength(1)
    expect(check.errors[0]).toContain('il reste un écart de 0,01 €')
    expect(check.errors[0]).toContain('Kledg ne lettre pas partiellement')
  })

  it('refuses a single line', () => {
    expect(checkSelection([invoice]).errors[0]).toMatch(/au moins deux lignes/)
  })

  it('refuses lines already lettered', () => {
    expect(checkSelection([invoice, { ...payment, letteringCode: 'AB' }]).errors.join(' ')).toContain('déjà lettrées (AB)')
  })

  it('refuses two auxiliary accounts, accepts a payment without one', () => {
    expect(checkSelection([invoice, { ...payment, auxiliaryAccountNumber: 'C002' }]).errors.join(' ')).toContain('C001, C002')
    expect(checkSelection([invoice, { ...payment, auxiliaryAccountNumber: null }]).errors).toEqual([])
  })

  it('formats amounts the French way without Intl', () => {
    expect(formatEuros(123_456_789)).toBe('1 234 567,89 €')
    expect(formatEuros(-5)).toBe('-0,05 €')
  })
})
