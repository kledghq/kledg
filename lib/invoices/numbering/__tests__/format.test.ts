/**
 * Rules of the sales invoice numbering on plain values (CGI ann. II art. 242
 * nonies A, I, 7°: a unique number in a chronological and continuous
 * sequence; BOI-TVA-DECLA-30-20-20-10 § 80 to 100: separate series allowed,
 * two invoices of the same year never share a number).
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NUMBERING,
  formatOf,
  numberingProblems,
  parseSequence,
  patternOf,
  periodOf,
  renderNumber,
  seriesOf,
  sequencePattern,
  typeCodesOf,
  type InvoiceNumberingSettings,
} from '../format'
import { InvoiceNumberingBodySchema, readNumberingSettings } from '../settings'

const settings = (over: Partial<InvoiceNumberingSettings> = {}): InvoiceNumberingSettings => ({ ...DEFAULT_NUMBERING, ...over })
const at = (sequence: number, year = 2026, month = 3) => ({ year, month, sequence })

describe('rendering a number', () => {
  it('gives F2026-0001 by default, the template F{YYYY}-{SEQ:4}', () => {
    expect(renderNumber(formatOf(settings(), 'INVOICE'), at(1))).toBe('F2026-0001')
    expect(patternOf(formatOf(settings(), 'INVOICE'))).toBe('F{YYYY}-{SEQ:4}')
  })

  it('builds the number from its parts: two digit year, month, separator, padding', () => {
    expect(renderNumber(formatOf(settings({ year: 'YY', month: true, separator: '/', padding: 3, prefix: 'FA' }), 'INVOICE'), at(7, 2026, 3))).toBe('FA26/03/007')
    expect(patternOf(formatOf(settings({ year: 'YY', month: true, separator: '/', padding: 3, prefix: 'FA' }), 'INVOICE'))).toBe('FA{YY}/{MM}/{SEQ:3}')
    expect(renderNumber(formatOf(settings({ year: 'NONE', reset: 'NEVER', separator: '', prefix: 'INV' }), 'INVOICE'), at(12))).toBe('INV0012')
    expect(renderNumber(formatOf(settings({ year: 'YY' }), 'INVOICE'), at(5, 2105))).toBe('F05-0005')
  })

  it('never cuts a sequence longer than its padding', () => {
    expect(renderNumber(formatOf(settings(), 'INVOICE'), at(10_000))).toBe('F2026-10000')
    expect(renderNumber(formatOf(settings({ padding: 1 }), 'INVOICE'), at(123))).toBe('F2026-123')
  })

  it('numbers credit notes in the invoice series, or in their own with their prefix', () => {
    expect(seriesOf(settings(), '381')).toBe('INVOICE')
    expect(typeCodesOf(settings(), 'INVOICE')).toEqual(['380', '381'])
    const own = settings({ creditNotes: 'OWN_SERIES', creditNotePrefix: 'A' })
    expect(seriesOf(own, '381')).toBe('CREDIT_NOTE')
    expect(seriesOf(own, '380')).toBe('INVOICE')
    expect(typeCodesOf(own, 'CREDIT_NOTE')).toEqual(['381'])
    expect(renderNumber(formatOf(own, 'CREDIT_NOTE'), at(1))).toBe('A2026-0001')
  })
})

describe('parsing existing numbers', () => {
  const format = formatOf(settings(), 'INVOICE')

  it('reads the sequence of a number of the series and period, padded or not', () => {
    expect(parseSequence(format, 2026, 'F2026-0042')).toBe(42)
    expect(parseSequence(format, 2026, 'F2026-12345')).toBe(12345)
    expect(parseSequence(format, 2026, 'F2026-7')).toBe(7)
  })

  it('ignores numbers of another year, prefix or shape', () => {
    expect(parseSequence(format, 2026, 'F2025-0042')).toBeNull()
    expect(parseSequence(format, 2026, 'FA2026-0042')).toBeNull()
    expect(parseSequence(format, 2026, 'F2026-0042-B')).toBeNull()
    expect(parseSequence(format, 2026, 'F2026-')).toBeNull()
    expect(parseSequence(format, null, 'F2019-0003')).toBe(3)
  })

  it('escapes the prefix and separator, and only accepts real months', () => {
    const dotted = formatOf(settings({ prefix: 'F.', separator: '.', month: true }), 'INVOICE')
    expect(parseSequence(dotted, 2026, 'F.2026.03.0009')).toBe(9)
    expect(parseSequence(dotted, 2026, 'Fx2026x03x0009')).toBeNull()
    expect(parseSequence(dotted, 2026, 'F.2026.13.0009')).toBeNull()
    expect(sequencePattern(dotted, 2026)).toBe('^F\\.2026\\.(?:0[1-9]|1[0-2])\\.([0-9]{1,9})$')
  })
})

describe('periods and resets', () => {
  it('restarts each calendar year by default, the year printed being the invoice year', () => {
    expect(periodOf('YEARLY', '2026-12-31', null)).toEqual({ key: '2026', year: 2026, month: 12 })
    expect(periodOf('YEARLY', '2027-01-01', null)).toEqual({ key: '2027', year: 2027, month: 1 })
  })

  it('restarts at each fiscal year, printing the year it ends', () => {
    expect(periodOf('FISCAL_YEAR', '2026-09-15', { id: 'fy1', endDay: '2027-06-30' })).toEqual({ key: 'FY:fy1', year: 2027, month: 9 })
    expect(periodOf('FISCAL_YEAR', '2026-09-15', null)).toBeNull()
  })

  it('never restarts a continuous series', () => {
    expect(periodOf('NEVER', '2030-05-01', null)?.key).toBe('ALL')
  })
})

describe('configuration checks', () => {
  it('accepts the defaults', () => {
    expect(numberingProblems(settings())).toEqual([])
  })

  it('requires the year when the sequence restarts, otherwise two invoices would share a number', () => {
    expect(numberingProblems(settings({ year: 'NONE' }))).toEqual([expect.stringMatching(/ajoutez l’année/)])
    expect(numberingProblems(settings({ year: 'NONE', reset: 'NEVER' }))).toEqual([])
  })

  it('refuses a credit note series with the invoice prefix, and a bad prefix', () => {
    expect(numberingProblems(settings({ creditNotes: 'OWN_SERIES', creditNotePrefix: 'F' }))).toEqual([expect.stringMatching(/préfixe différent/)])
    expect(numberingProblems(settings({ prefix: 'F 1' }))).toEqual([expect.stringMatching(/20 lettres/)])
  })

  it('validates the API body and reads a stored configuration with defaults for what is missing', () => {
    expect(InvoiceNumberingBodySchema.safeParse({ settings: settings({ padding: 12 }) }).success).toBe(false)
    expect(InvoiceNumberingBodySchema.safeParse({ settings: settings(), nextNumbers: { invoice: 0 } }).success).toBe(false)
    expect(InvoiceNumberingBodySchema.safeParse({ settings: settings(), nextNumbers: { invoice: 138 } }).success).toBe(true)
    expect(readNumberingSettings(null)).toEqual(DEFAULT_NUMBERING)
    expect(readNumberingSettings({ mode: 'MANUAL' })).toEqual({ ...DEFAULT_NUMBERING, mode: 'MANUAL' })
    expect(readNumberingSettings({ year: 'bad' })).toEqual(DEFAULT_NUMBERING)
  })
})
