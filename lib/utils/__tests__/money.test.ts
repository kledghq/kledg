import { describe, expect, it } from 'vitest'
import {
  AMOUNT_ERRORS,
  centsToDecimal,
  formatAmountInput,
  formatCentsFr,
  fromCents,
  parseAmount,
  parseCents,
  toCents,
} from '../money'

const cents = (input: string, options?: { allowNegative?: boolean }) => {
  const result = parseAmount(input, options)
  return result.ok ? result.cents : result.error
}

describe('parseAmount', () => {
  it.each([
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['1 234,56', 123456],
    ['1 234,56', 123456], // non-breaking space
    ['1 234,56', 123456], // narrow non-breaking space (Intl fr-FR)
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234.567', 123456700],
    ['1 234 567,8', 123456780],
    ['  42  ', 4200],
    ['42,5', 4250],
    ['42,', 4200],
    [',5', 50],
    ['0,01', 1],
    ['1 234,56 €', 123456],
    ['€12', 1200],
    ['12 EUR', 1200],
    ['+3,10', 310],
    ['007,50', 750],
    ['0', 0],
  ])('reads %j as %d cents', (input, expected) => {
    expect(cents(input)).toBe(expected)
  })

  it('treats empty input as no amount', () => {
    expect(parseAmount('')).toEqual({ ok: true, cents: null })
    expect(parseAmount('   ')).toEqual({ ok: true, cents: null })
  })

  it.each([
    ['abc', AMOUNT_ERRORS.invalid],
    ['12a', AMOUNT_ERRORS.invalid],
    ['1,2,3', AMOUNT_ERRORS.invalid],
    ['12,34.5', AMOUNT_ERRORS.invalid],
    ['1.2.3', AMOUNT_ERRORS.invalid],
    ['.', AMOUNT_ERRORS.invalid],
    ['-', AMOUNT_ERRORS.invalid],
    ['1e5', AMOUNT_ERRORS.invalid],
    ['12,345', AMOUNT_ERRORS.decimals],
    ['1.234', AMOUNT_ERRORS.decimals],
    ['0,001', AMOUNT_ERRORS.decimals],
    ['12345678901234', AMOUNT_ERRORS.tooLarge],
    ['-5', AMOUNT_ERRORS.negative],
    ['−12,50', AMOUNT_ERRORS.negative],
  ])('refuses %j', (input, error) => {
    expect(cents(input)).toBe(error)
  })

  it('accepts negative amounts when allowed', () => {
    expect(cents('-1 234,56', { allowNegative: true })).toBe(-123456)
    expect(cents('-0', { allowNegative: false })).toBe(0)
  })

  it('accepts the largest Decimal(15,2) amount exactly', () => {
    expect(cents('9 999 999 999 999,99')).toBe(999999999999999)
  })
})

describe('formatting', () => {
  it('formats cents for an input', () => {
    expect(formatAmountInput(123456)).toBe('1 234,56')
    expect(formatAmountInput(5)).toBe('0,05')
    expect(formatAmountInput(100000000)).toBe('1 000 000,00')
    expect(formatAmountInput(-1050)).toBe('-10,50')
  })

  it('formats cents as euros for messages', () => {
    expect(formatCentsFr(123456)).toBe('1 234,56 €')
    expect(formatCentsFr(-5)).toBe('-0,05 €')
    expect(formatCentsFr(BigInt('123456789012345'))).toBe('1 234 567 890 123,45 €')
  })

  it('converts cents to a decimal string', () => {
    expect(centsToDecimal(123456)).toBe('1234.56')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(-1050)).toBe('-10.50')
    expect(() => centsToDecimal(1.5)).toThrow(RangeError)
    expect(() => centsToDecimal(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
    expect(centsToDecimal(BigInt('900719925474099300'))).toBe('9007199254740993.00')
  })
})

describe('toCents', () => {
  it.each([
    ['1234.56', 123456],
    ['0.1', 10],
    ['-0.05', -5],
    ['12', 1200],
    ['83.335', 8334],
    ['83.334', 8333],
  ])('converts the decimal string %j', (input, expected) => {
    expect(toCents(input)).toBe(expected)
  })

  it('rounds floats half away from zero without binary drift', () => {
    expect(toCents(1.005)).toBe(101)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(100 / 1.2)).toBe(8333)
    expect(toCents(-2.675)).toBe(-268)
  })

  it('reads Prisma.Decimal-like objects through toString', () => {
    expect(toCents({ toString: () => '99.90' })).toBe(9990)
  })

  it('returns null for anything that is not a decimal', () => {
    expect(toCents(null)).toBeNull()
    expect(toCents(undefined)).toBeNull()
    expect(toCents(Number.NaN)).toBeNull()
    expect(toCents('abc')).toBeNull()
    expect(toCents('1,5')).toBeNull()
    expect(toCents('')).toBeNull()
  })
})

/** Deterministic PRNG (mulberry32) so a failure can be replayed. */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('randomized round trips', () => {
  const random = rng(20261003)
  const randomCents = () => {
    const magnitude = Math.floor(random() * 12) // up to 10^12 cents
    return Math.floor(random() * 10 ** magnitude)
  }
  const spaces = [' ', ' ', ' ', '']

  it('parses what formatAmountInput writes, with any space', () => {
    for (let i = 0; i < 2000; i++) {
      const value = randomCents()
      const space = spaces[Math.floor(random() * spaces.length)]
      const text = formatAmountInput(value).replace(/ /g, space)
      expect(cents(text), text).toBe(value)
    }
  })

  it('parses English-style and dot-grouped writings of the same amount', () => {
    for (let i = 0; i < 2000; i++) {
      const value = randomCents()
      const euros = Math.floor(value / 100).toString()
      const fraction = String(value % 100).padStart(2, '0')
      const grouped = (sep: string) => euros.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
      expect(cents(`${euros}.${fraction}`)).toBe(value)
      expect(cents(`${grouped(',')}.${fraction}`)).toBe(value)
      expect(cents(`${grouped('.')},${fraction}`)).toBe(value)
    }
  })

  it('round-trips cents through decimal strings', () => {
    for (let i = 0; i < 2000; i++) {
      const value = randomCents() * (random() < 0.5 ? -1 : 1) || 0
      expect(toCents(centsToDecimal(value))).toBe(value)
    }
  })

  it('sums parsed amounts exactly where float euros drift', () => {
    const amounts = Array.from({ length: 500 }, () => Math.floor(random() * 100000))
    const exact = amounts.reduce((sum, c) => sum + c, 0)
    const parsed = amounts.map((c) => cents(formatAmountInput(c)) as number)
    expect(parsed.reduce((sum, c) => sum + c, 0)).toBe(exact)
  })

  it('never throws on random garbage', () => {
    const alphabet = '0123456789 ,.-+€abc  '
    for (let i = 0; i < 3000; i++) {
      const length = Math.floor(random() * 12)
      const text = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')
      const result = parseAmount(text, { allowNegative: true })
      if (result.ok && result.cents !== null) expect(Number.isSafeInteger(result.cents)).toBe(true)
    }
  })
})

describe('one module for money', () => {
  it('fromCents gives euros back as a number', () => {
    expect(fromCents(123456)).toBe(1234.56)
    expect(fromCents(-5)).toBe(-0.05)
    expect(fromCents(0)).toBe(0)
  })

  // Report balances arrive as sums of cents divided by 100 (lib/reports/account-balances.ts);
  // the statements read them back with toCents, which used to go through parseCents first.
  it('toCents gives back the cents of a balance computed as cents / 100, like parseCents', () => {
    const samples = [0, 1, 5, 10, 99, 100, 101, 12345, 99999, 123456789, 999999999999, 10 ** 15 - 1]
    for (let i = 0; i < 2000; i++) samples.push(Math.floor(Math.random() * 10 ** (1 + (i % 15))))
    for (const value of samples) {
      for (const signed of [value, -value]) {
        const euros = signed / 100
        expect(toCents(euros)).toBe(signed === 0 ? 0 : signed)
        expect(toCents(euros)).toBe(parseCents(euros))
      }
    }
  })

  it('parseCents refuses a third decimal that toCents rounds', () => {
    expect(parseCents('10.005')).toBeNull()
    expect(toCents('10.005')).toBe(1001)
    expect(parseCents(10.005)).toBeNull()
    expect(toCents(10.005)).toBe(1001)
  })

  it('round-trips every helper through centsToDecimal', () => {
    for (const value of [0, 1, -1, 5, 1050, -1050, 123456, 99999999999999]) {
      const decimal = centsToDecimal(value)
      expect(parseCents(decimal)).toBe(value)
      expect(toCents(decimal)).toBe(value)
      expect(parseAmount(decimal.replace('.', ','), { allowNegative: true })).toEqual({ ok: true, cents: value })
    }
  })
})
