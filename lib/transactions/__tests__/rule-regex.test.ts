import { describe, expect, it } from 'vitest'
import { compileRulePattern, MAX_PROGRAM_SIZE, RULE_PATTERN_MAX_LENGTH } from '../rule-regex'

function compiled(pattern: string) {
  const result = compileRulePattern(pattern)
  if (!result.ok) throw new Error(`${pattern}: ${result.message}`)
  return result.pattern
}

const PATTERNS = [
  '^VIR .*',
  'salaire',
  '^(vir|prlv) sepa',
  'loyer\\s+\\d{2}/\\d{4}$',
  '[a-z]+-\\d+',
  '[^0-9]+',
  '[^a]',
  '\\bEDF\\b',
  '\\Bdf',
  'a{2,3}b?',
  'x{2,}',
  'colou?r',
  '(?:ab)*c',
  '(?<ref>FAC)-\\d+',
  '\\.',
  'a.c',
  '[\\d-z]',
  '[.-]',
  '\\x41\\u0042',
  'é',
  '^$',
  '',
  'a|',
  '(a*)*b',
  '(a|ab)(c|bcd)(d*)',
  'A{0}b',
  '{',
  'a{,2}',
  ']',
  '[]',
  '[^]',
  '\\w+@\\w+\\.fr',
  '^\\S+ \\S+$',
  '\\t',
  'amazon|amzn|aws',
  'cb .* (paris|lyon)',
  '\\0',
]

const TEXTS = [
  'VIR SALAIRE MARS',
  'vir sepa dupont',
  'PRLV SEPA EDF',
  'loyer   03/2026',
  'abc-42',
  'Colour Color colr',
  'aaab',
  'xx',
  'a.c abc',
  '',
  'contact@kledg.fr',
  'deux mots',
  'Café',
  'tab\there',
  'CB CARREFOUR 12/03 PARIS',
  'AMZN Mktp',
  'ABCD',
  'é',
  'z-',
  'a{,2}',
  ']',
  'A',
  '\u0000',
]

describe('rule regex: same results as RegExp(pattern, "i")', () => {
  it.each(PATTERNS)('%s', (pattern) => {
    const ours = compiled(pattern)
    const native = new RegExp(pattern, 'i')
    for (const text of TEXTS) expect(ours.test(text), JSON.stringify(text)).toBe(native.test(text))
  })
})

describe('rule regex: refused patterns', () => {
  it.each([
    ['(a)\\1', /références arrière/],
    ['(?=a)', /assertions/],
    ['(?!a)', /assertions/],
    ['(?<=a)b', /assertions/],
    ['(?<!a)b', /assertions/],
    ['\\p{L}', /non prise en charge/],
    ['\\q', /non prise en charge/],
    ['(a', /non fermée/],
    ['a)', /sans parenthèse ouvrante/],
    ['[a', /non fermé/],
    ['*a', /rien à répéter/],
    ['a{3,2}', /désordre/],
    ['[z-a]', /désordre/],
    ['a{1001}', /au-delà/],
    ['^*', /ancre/],
    ['\\', /fin de motif/],
    ['\\x4', /invalide/],
    ['(?<1a>x)', /nom de groupe/],
  ])('%s', (pattern, message) => {
    const result = compileRulePattern(pattern)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(message)
  })

  it('refuses a pattern longer than the limit', () => {
    const result = compileRulePattern('a'.repeat(RULE_PATTERN_MAX_LENGTH + 1))
    expect(result.ok).toBe(false)
  })

  it(`refuses a pattern compiling to more than ${MAX_PROGRAM_SIZE} states`, () => {
    expect(compileRulePattern('(a{100}){100}').ok).toBe(false)
    expect(compileRulePattern('((((a{9}){9}){9}){9})').ok).toBe(false)
  })
})

describe('rule regex: linear time', () => {
  it.each([
    ['^(a+)+$', 'a'.repeat(5_000) + '!'],
    ['^(a|a)*$', 'a'.repeat(5_000) + '!'],
    ['(.*){20}x', 'y'.repeat(5_000)],
    ['.*.*.*.*.*.*x', 'y'.repeat(5_000)],
    ['(\\w+\\s?)+$', 'word '.repeat(1_000) + '!'],
  ])('%s on a crafted text', (pattern, text) => {
    const start = performance.now()
    expect(compiled(pattern).test(text, { remaining: Number.MAX_SAFE_INTEGER })).toBe(false)
    expect(performance.now() - start).toBeLessThan(500)
  })

  it('stops when the step budget runs out and says so', () => {
    const budget = { remaining: 1_000 }
    expect(compiled('(.*){20}x').test('y'.repeat(5_000), budget)).toBeNull()
    expect(budget.remaining).toBeLessThan(0)
  })
})
