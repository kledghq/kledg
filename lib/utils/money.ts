/**
 * Money: amounts are integer cents. The one module for parsing, converting,
 * summing and formatting them (docs/conventions.md#money).
 *
 * Accounting sums must be exact: amounts are kept as integer numbers of cents
 * (safe up to 90 000 milliards d'euros) and never added as floating point
 * euros: 0.1 + 0.2 is 30 cents, not 0.30000000000000004. Sums use BigInt so
 * that thousands of lines at the column maximum (Decimal(15, 2)) stay exact.
 *
 * | Need | Helper |
 * |---|---|
 * | Entry amount (JSON number, string, Decimal), refuse a third decimal | parseCents |
 * | External decimal rounded to the cent (bank feeds, computed rates) | toCents |
 * | Amount typed by a user ("1 234,56") | parseAmount |
 * | Exact sum | sumCents |
 * | Cents to Prisma.Decimal, FEC, message, input, euros | centsToDecimal, centsToFecAmount, formatCentsFr, formatAmountInput, fromCents |
 *
 * Display in the UI goes through <Amount> / formatAmount (components/shared).
 * Bank statement files have their own parser (lib/banking/import/amount.ts:
 * parentheses, trailing signs, a forced decimal separator).
 *
 * No imports: usable in client components (totals of the entry form).
 */

/** Decimal(15, 2) in the database: 13 digits before the decimal point. */
const MAX_INTEGER_DIGITS = 13

export type AmountInput = number | string | { toString(): string } | null | undefined

/** Largest amount in cents a Decimal(15, 2) holds. */
const MAX_CENTS = 10 ** (MAX_INTEGER_DIGITS + 2) - 1

/**
 * Cents of a JS number. A number that is a whole number of cents up to
 * floating point noise (0.1 + 0.2 = 0.30000000000000004, sums computed by
 * other code) is that number of cents; a real third decimal (10.005) is not
 * noise and gives null.
 */
function numberToCents(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const scaled = value * 100
  const cents = Math.round(scaled)
  if (Math.abs(cents) > MAX_CENTS) return null
  // A double has 15 to 17 significant digits: noise stays far below 1e-6 cent
  // for any Decimal(15, 2) amount, a third decimal is at least 0.1 cent away.
  if (Math.abs(scaled - cents) > Math.max(1e-6, Math.abs(scaled) * 1e-13)) return null
  return cents === 0 ? 0 : cents
}

/**
 * Cents of an amount, or null when the value is not a decimal with at most
 * two decimals. Strings and Decimals are read exactly ("10.005" is refused);
 * numbers through numberToCents. Empty values (null, undefined, "") are 0.
 */
export function parseCents(value: AmountInput): number | null {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return numberToCents(value)
  const text = value.toString().trim()
  if (text === '') return 0
  const match = /^([+-]?)(\d+)(?:[.,](\d{0,2}))?$/.exec(text) ?? /^([+-]?)()[.,](\d{1,2})$/.exec(text)
  if (!match) return null
  const [, sign, integerPart, fraction = ''] = match
  const digits = (integerPart || '0').replace(/^0+(?=\d)/, '')
  if (digits.length > MAX_INTEGER_DIGITS) return null
  const cents = Number(digits) * 100 + Number(fraction.padEnd(2, '0'))
  return sign === '-' && cents !== 0 ? -cents : cents
}

/** Exact sum of cents. */
export function sumCents(values: Iterable<number>): bigint {
  let total = BigInt(0)
  for (const value of values) total += BigInt(value)
  return total
}

/**
 * Cents as a decimal string for Prisma.Decimal, APIs and JSON: 123456 ->
 * "1234.56", -5 -> "-0.05". Throws a RangeError for a number that is not a
 * safe integer (a float or an amount beyond 2^53 cents is a bug upstream).
 */
export function centsToDecimal(cents: number | bigint): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents)) throw new RangeError(`Invalid cents: ${cents}`)
  const value = BigInt(cents)
  const negative = value < BigInt(0)
  const abs = negative ? -value : value
  const hundred = BigInt(100)
  return `${negative ? '-' : ''}${abs / hundred}.${String(abs % hundred).padStart(2, '0')}`
}

/** Cents in FEC notation (LPF art. A47 A-1): decimal comma, no thousands separator: "1234,56". */
export function centsToFecAmount(cents: number | bigint): string {
  return centsToDecimal(cents).replace('.', ',')
}

/** Cents for messages and errors: "1 234,56 €" (regular spaces, exact for BigInt sums). */
export function formatCentsFr(cents: number | bigint): string {
  const [integer, fraction] = centsToDecimal(cents).split('.')
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction} €`
}

/** Cents to euros as a number, for report values computed in cents and returned as numbers. */
export function fromCents(cents: number): number {
  return cents / 100
}

/*
 * Amounts typed by French users: "1 234,56", "1234,56", "1234.56",
 * "1.234,56", "1,234.56", with any kind of space as thousands separator
 * (including the non-breaking and narrow non-breaking spaces that Intl and
 * spreadsheets use), an optional "€" or "EUR", and at most two decimals.
 */

export type AmountParseResult = { ok: true; cents: number | null } | { ok: false; error: string }

/** Every space a user can paste: regular, non-breaking, narrow non-breaking, thin, plus the Swiss apostrophe. */
const SEPARATOR_SPACES = /[\s    ']/g

export const AMOUNT_ERRORS = {
  invalid: 'Montant invalide (exemple : 1 234,56)',
  decimals: 'Deux décimales au maximum',
  tooLarge: 'Montant trop élevé',
  negative: 'Le montant doit être positif',
} as const

/**
 * Parses a typed amount. Empty input gives `{ ok: true, cents: null }`.
 * Negative amounts are refused unless `allowNegative` is set.
 */
export function parseAmount(input: string, options: { allowNegative?: boolean } = {}): AmountParseResult {
  let s = input.replace(SEPARATOR_SPACES, '').replace(/€|eur$/gi, '')
  if (s === '') return { ok: true, cents: null }

  let negative = false
  if (s[0] === '-' || s[0] === '−') {
    negative = true
    s = s.slice(1)
  } else if (s[0] === '+') {
    s = s.slice(1)
  }
  if (!/\d/.test(s) || !/^[\d.,]+$/.test(s)) return { ok: false, error: AMOUNT_ERRORS.invalid }

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let integerPart: string
  let fraction = ''

  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators: the last one is the decimal separator, the other groups thousands.
    const decimal = lastComma > lastDot ? ',' : '.'
    const group = decimal === ',' ? '.' : ','
    const at = s.lastIndexOf(decimal)
    const head = s.slice(0, at)
    if (head.includes(decimal) || !isGrouped(head, group)) return { ok: false, error: AMOUNT_ERRORS.invalid }
    integerPart = head.split(group).join('')
    fraction = s.slice(at + 1)
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.'
    const parts = s.split(separator)
    if (parts.length === 2) {
      ;[integerPart, fraction] = parts
    } else if (separator === '.' && isGrouped(s, '.')) {
      // "1.234.567": dots used as thousands separators
      integerPart = parts.join('')
    } else {
      return { ok: false, error: AMOUNT_ERRORS.invalid }
    }
  } else {
    integerPart = s
  }

  if (integerPart === '') integerPart = '0' // ",50"
  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fraction)) return { ok: false, error: AMOUNT_ERRORS.invalid }
  if (fraction.length > 2) return { ok: false, error: AMOUNT_ERRORS.decimals }
  const digits = integerPart.replace(/^0+(?=\d)/, '')
  if (digits.length > MAX_INTEGER_DIGITS) return { ok: false, error: AMOUNT_ERRORS.tooLarge }

  const cents = Number(digits) * 100 + Number(fraction.padEnd(2, '0'))
  if (negative && cents !== 0) {
    if (!options.allowNegative) return { ok: false, error: AMOUNT_ERRORS.negative }
    return { ok: true, cents: -cents }
  }
  return { ok: true, cents }
}

/** "1.234.567" or "1,234": the first group has 1 to 3 digits, the others exactly 3. */
function isGrouped(value: string, group: string): boolean {
  const parts = value.split(group)
  if (parts.length === 1) return true
  return /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))
}

/** Cents as typed in a French input: "1 234,56" (regular spaces, easy to edit). */
export function formatAmountInput(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${sign}${euros},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Converts a decimal value (string, number, or Prisma.Decimal) to cents,
 * rounding half away from zero on the third decimal. Returns null when the
 * value is not a finite decimal number. For values that come from outside
 * the ledger (bank feeds, computed rates); an entry amount goes through
 * parseCents, which refuses a third decimal instead of rounding it.
 */
export function toCents(value: string | number | { toString(): string } | null | undefined): number | null {
  if (value === null || value === undefined) return null
  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // Fixed notation with enough digits to round correctly (1.005 -> "1.005000" -> 1.01)
    text = value.toFixed(6)
  } else {
    text = value.toString().trim()
  }
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && !match[3])) return null
  const [, sign, intPart, frac = ''] = match
  const integer = intPart === '' ? 0 : Number(intPart)
  let cents = integer * 100 + Number(frac.slice(0, 2).padEnd(2, '0'))
  if (Number(frac[2] ?? '0') >= 5) cents += 1
  if (!Number.isSafeInteger(cents)) return null
  return sign === '-' && cents !== 0 ? -cents : cents
}
