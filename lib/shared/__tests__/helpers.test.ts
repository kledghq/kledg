/**
 * Tests for shared helpers (journal codes, PCG class of an account code)
 */

import { describe, it, expect } from 'vitest'
import { normalizeJournalCode, isValidJournalCode, extractPCGClass } from '../helpers'

describe('normalizeJournalCode', () => {
  it('should normalize journal code', () => {
    expect(normalizeJournalCode('  BQ  ')).toBe('BQ')
    expect(normalizeJournalCode('bq')).toBe('BQ')
  })
})

describe('isValidJournalCode', () => {
  it('should return true for valid journal codes', () => {
    expect(isValidJournalCode('BQ')).toBe(true)
    expect(isValidJournalCode('OD')).toBe(true)
    expect(isValidJournalCode('AC')).toBe(true)
    expect(isValidJournalCode('BQ2')).toBe(true)
    expect(isValidJournalCode('12')).toBe(true)
  })

  it('should return false for invalid journal codes', () => {
    expect(isValidJournalCode('B')).toBe(false) // Too short
    expect(isValidJournalCode('ABCD')).toBe(false) // Too long
  })
})

describe('extractPCGClass', () => {
  it('should extract PCG class from account code', () => {
    expect(extractPCGClass('512')).toBe('5')
    expect(extractPCGClass('411000')).toBe('4')
    expect(extractPCGClass('701000')).toBe('7')
    expect(extractPCGClass(' 4 11 000 ')).toBe('4')
  })

  it('should return null for invalid account codes', () => {
    expect(extractPCGClass('ABC')).toBeNull()
    expect(extractPCGClass('0')).toBeNull()
  })
})
