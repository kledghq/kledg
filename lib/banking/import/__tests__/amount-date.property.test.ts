/**
 * Property tests of the amount and date parsers, with a seeded generator
 * (fast-check is not a dependency): every run checks the same cases, and a
 * failure prints the seed and the input.
 */

import { describe, expect, it } from 'vitest'
import { centsToDecimal } from '@/lib/utils/money'
import { detectDecimalSeparator, parseAmountCents } from '../amount'
import { detectDateFormat, parseCalendarDate } from '../date'

/** Park-Miller minimal standard generator. */
function rng(seed: number) {
  let state = seed % 2147483647 || 1
  const next = () => (state = (state * 48271) % 2147483647) / 2147483647
  return {
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
  }
}

const RUNS = 2000

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/** Writes cents the way a French or foreign bank could. */
function format(cents: number, style: number, r: ReturnType<typeof rng>): { text: string; decimal?: ',' | '.' } {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const int = String(Math.floor(abs / 100))
  const frac = String(abs % 100).padStart(2, '0')
  const sign = negative ? r.pick(['-', '−']) : r.pick(['', '+'])
  switch (style) {
    case 0: // 1 234,56 with any French space
      return { text: `${sign}${group(int, r.pick([' ', ' ', ' ']))},${frac}` }
    case 1: // 1.234,56
      return { text: `${sign}${group(int, '.')},${frac}`, decimal: ',' }
    case 2: // -1234,56
      return { text: `${sign}${int},${frac}` }
    case 3: // 1234.56
      return { text: `${sign}${int}.${frac}` }
    case 4: // 1,234.56
      return { text: `${sign}${group(int, ',')}.${frac}`, decimal: '.' }
    case 5: // 1 234,56 € or €1234,56 or 1234,56 EUR
      return { text: r.pick([`${sign}${group(int, ' ')},${frac} €`, `${sign}€${int},${frac}`, `${sign}${int},${frac} EUR`]) }
    case 6: // trailing sign: 1234,56-
      return { text: `${int},${frac}${negative ? '-' : ''}` }
    default: // (1 234,56) accounting negative
      return { text: negative ? `(${group(int, ' ')},${frac})` : `${int},${frac}` }
  }
}

describe('parseAmountCents (property)', () => {
  it('reads back any amount written in any supported notation', () => {
    const r = rng(20261003)
    for (let i = 0; i < RUNS; i++) {
      const magnitude = r.pick([100, 10_000, 1_000_000, 100_000_000, 10_000_000_000])
      const cents = r.int(-magnitude, magnitude)
      const style = r.int(0, 7)
      const { text, decimal } = format(cents, style, r)
      const parsed = parseAmountCents(text, decimal)
      if (parsed !== cents) throw new Error(`style ${style}: "${text}" (decimal ${decimal}) gave ${parsed}, expected ${cents}`)
    }
  })

  it('round-trips through centsToDecimal exactly (no float drift)', () => {
    const r = rng(42)
    for (let i = 0; i < RUNS; i++) {
      const cents = r.int(-9_000_000_000_000, 9_000_000_000_000)
      const decimal = centsToDecimal(cents)
      expect(decimal).toMatch(/^-?\d+\.\d{2}$/)
      expect(parseAmountCents(decimal, '.')).toBe(cents)
    }
    expect(centsToDecimal(-5)).toBe('-0.05')
    expect(centsToDecimal(0)).toBe('0.00')
  })

  it('never throws and only returns safe integers or null on arbitrary text', () => {
    const r = rng(99)
    const alphabet = '0123456789 ,.-+()€$EURabc  −\'\t'
    for (let i = 0; i < RUNS; i++) {
      const text = Array.from({ length: r.int(0, 16) }, () => r.pick([...alphabet])).join('')
      for (const decimal of [undefined, ',', '.'] as const) {
        const parsed = parseAmountCents(text, decimal)
        if (parsed !== null && !Number.isSafeInteger(parsed)) throw new Error(`"${text}" gave ${parsed}`)
      }
    }
  })

  it('handles the classic French cases', () => {
    expect(parseAmountCents('1 234,56')).toBe(123456)
    expect(parseAmountCents('-1234,56')).toBe(-123456)
    expect(parseAmountCents('1 234,56 €')).toBe(123456)
    expect(parseAmountCents('1.234,56')).toBe(123456)
    expect(parseAmountCents('1.234', ',')).toBe(123400)
    expect(parseAmountCents('12,5')).toBe(1250)
    expect(parseAmountCents('0,10')).toBe(10)
    expect(parseAmountCents('-0,00')).toBe(0)
    expect(parseAmountCents('12,3400')).toBe(1234)
    expect(parseAmountCents(45.1)).toBe(4510)
    expect(parseAmountCents(1.005)).toBe(101)
    // Rejected: sub-cent digits, malformed groups, text
    expect(parseAmountCents('12,345')).toBeNull()
    expect(parseAmountCents('1.23,45')).toBeNull()
    expect(parseAmountCents('12 euros')).toBeNull()
    expect(parseAmountCents('')).toBeNull()
    expect(parseAmountCents('-')).toBeNull()
  })

  it('detects the decimal separator of a column', () => {
    expect(detectDecimalSeparator(['-12,50', '1 200,00'])).toBe(',')
    expect(detectDecimalSeparator(['-12.50', '1200.00', '3'])).toBe('.')
    expect(detectDecimalSeparator(['12', '15'])).toBe(',')
  })
})

describe('parseCalendarDate (property)', () => {
  const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')

  it('reads any valid day in every layout, ignoring a time part', () => {
    const r = rng(1789)
    for (let i = 0; i < RUNS; i++) {
      const y = r.int(2000, 2069)
      const m = r.int(1, 12)
      const d = r.int(1, daysIn(y, m))
      const iso = `${y}-${pad(m)}-${pad(d)}`
      const time = r.pick(['', ' 00:00:00', ' 23:59:59', 'T23:30:00+01:00', 'T00:15:00-05:00'])
      const sep = r.pick(['/', '.', '-'])
      const cases: Array<[string, Parameters<typeof parseCalendarDate>[1]]> = [
        [`${pad(d)}${sep}${pad(m)}${sep}${y}`, 'dd/mm/yyyy'],
        [`${d}/${m}/${y}`, 'dd/mm/yyyy'],
        [`${pad(d)}/${pad(m)}/${pad(y % 100)}`, 'dd/mm/yy'],
        [`${iso}${time}`, 'yyyy-mm-dd'],
        [`${y}${pad(m)}${pad(d)}`, 'yyyymmdd'],
        [`${pad(m)}/${pad(d)}/${y}`, 'mm/dd/yyyy'],
      ]
      for (const [text, layout] of cases) {
        const parsed = parseCalendarDate(text, layout)
        if (parsed !== iso) throw new Error(`"${text}" as ${layout} gave ${parsed}, expected ${iso}`)
      }
      // Without a layout, day first (French)
      expect(parseCalendarDate(`${pad(d)}/${pad(m)}/${y}`)).toBe(iso)
    }
  })

  it('rejects days that do not exist', () => {
    const r = rng(2024)
    for (let i = 0; i < RUNS; i++) {
      const y = r.int(1990, 2100)
      const m = r.int(1, 12)
      const d = daysIn(y, m) + r.int(1, 5)
      expect(parseCalendarDate(`${pad(d)}/${pad(m)}/${y}`, 'dd/mm/yyyy')).toBeNull()
      expect(parseCalendarDate(`${y}-${pad(m)}-${pad(d)}`)).toBeNull()
    }
    expect(parseCalendarDate('29/02/2026')).toBeNull()
    expect(parseCalendarDate('29/02/2028')).toBe('2028-02-29')
    expect(parseCalendarDate('15/13/2026')).toBeNull()
  })

  it('never throws on arbitrary text', () => {
    const r = rng(3)
    const alphabet = '0123456789/-.: TZ+abc'
    for (let i = 0; i < RUNS; i++) {
      const text = Array.from({ length: r.int(0, 25) }, () => r.pick([...alphabet])).join('')
      const parsed = parseCalendarDate(text)
      if (parsed !== null && !/^\d{4}-\d{2}-\d{2}$/.test(parsed)) throw new Error(`"${text}" gave ${parsed}`)
    }
  })

  it('detects the layout of a column', () => {
    expect(detectDateFormat(['01/03/2026', '15/03/2026'])).toBe('dd/mm/yyyy')
    expect(detectDateFormat(['01/03/26', '15/03/26'])).toBe('dd/mm/yy')
    expect(detectDateFormat(['2026-03-01 10:00:00'])).toBe('yyyy-mm-dd')
    expect(detectDateFormat(['03/01/2026', '03/15/2026'])).toBe('mm/dd/yyyy')
    expect(detectDateFormat(['20260301'])).toBe('yyyymmdd')
  })
})
