/**
 * Exact amount parsing for bank statements. Amounts are integers of cents,
 * never floats: "1 234,56" -> 123456.
 *
 * Accepted: French and English notations ("1 234,56", "1.234,56", "1,234.56",
 * "1234.56"), regular, non-breaking (U+00A0), narrow no-break (U+202F) and thin
 * (U+2009) spaces or apostrophes as thousands separators, a currency sign or
 * code (EUR, €), leading or trailing sign, the Unicode minus (U+2212) and
 * accounting parentheses "(12,00)".
 */

import type { DecimalSeparator } from './types'

const SPACES = /[\s    ']/g
const CURRENCY = /€|EUR|eur|\$|USD|GBP|£|CHF/g

/**
 * Parses an amount into signed cents. Returns null when the text is not an
 * amount (or has non-zero digits beyond the cent). Empty text returns null.
 *
 * `decimal` forces the decimal separator; without it, the last of "," and "."
 * is the decimal separator when both appear, a lone "," is decimal (French),
 * and a lone "." is decimal. "1.234" is ambiguous: it is read as 1234 only with
 * decimal ",", and rejected otherwise (three decimals).
 */
export function parseAmountCents(input: string | number | null | undefined, decimal?: DecimalSeparator): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    // Excel numbers: round to the cent (bank amounts have at most 2 decimals)
    return Math.round(Number((input * 100).toFixed(6))) + 0
  }
  let s = input.trim()
  if (!s) return null

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(CURRENCY, '').replace(SPACES, '').replace(/−/g, '-')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  } else if (s.endsWith('+')) {
    s = s.slice(0, -1)
  }
  if (!s || !/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let decimalSep: string | null
  if (decimal) {
    decimalSep = decimal
  } else if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.'
  } else if (lastComma >= 0) {
    decimalSep = s.indexOf(',') === lastComma ? ',' : null // "1,234,567" groups only
  } else if (lastDot >= 0) {
    decimalSep = s.indexOf('.') === lastDot ? '.' : null
  } else {
    decimalSep = null
  }

  let intPart = s
  let fracPart = ''
  if (decimalSep) {
    const at = s.lastIndexOf(decimalSep)
    if (at >= 0) {
      intPart = s.slice(0, at)
      fracPart = s.slice(at + 1)
    }
    const group = decimalSep === ',' ? '.' : ','
    if (fracPart.includes(group) || fracPart.includes(decimalSep)) return null
    // Thousands groups must be 3 digits: "1.234,56" ok, "12.34,56" is not an amount
    if (intPart.includes(group)) {
      const groups = intPart.split(group)
      if (groups.some((g, i) => (i === 0 ? g.length === 0 || g.length > 3 : g.length !== 3))) return null
      intPart = groups.join('')
    }
    if (intPart.includes(decimalSep)) return null
  } else {
    const group = s.includes(',') ? ',' : '.'
    const groups = s.split(group)
    if (groups.some((g, i) => (i === 0 ? g.length === 0 || g.length > 3 : g.length !== 3))) return null
    intPart = groups.join('')
  }

  if (intPart === '') intPart = '0'
  if (!/^\d+$/.test(intPart) || (fracPart && !/^\d+$/.test(fracPart))) return null
  // Digits beyond the cent are only accepted when they are zeros
  if (fracPart.length > 2) {
    if (!/^0+$/.test(fracPart.slice(2))) return null
    fracPart = fracPart.slice(0, 2)
  }
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(cents)) return null
  return negative && cents !== 0 ? -cents : cents
}

/**
 * Guesses the decimal separator of an amount column from sample values: a
 * value ending with ",dd" or ",d" means comma, ".dd" means dot. French by default.
 */
export function detectDecimalSeparator(samples: string[]): DecimalSeparator {
  let comma = 0
  let dot = 0
  for (const raw of samples) {
    const s = raw.replace(SPACES, '').replace(CURRENCY, '').replace(/[()+\-−]/g, '')
    if (/,\d{1,2}$/.test(s)) comma++
    else if (/\.\d{1,2}$/.test(s)) dot++
  }
  return dot > comma ? '.' : ','
}
