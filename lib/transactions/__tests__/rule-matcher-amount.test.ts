/**
 * Amount conditions of the rules engine compare the transaction in cents
 * with the bound the user (or rule-builder) wrote, exactly: no parseFloat,
 * no tolerance on floating point euros.
 */

import { describe, expect, it } from 'vitest'
import { extractConditionsFromTransaction } from '../rule-builder'
import { findMatchingRules, matchAmount, type RuleWithConditions } from '../rule-matcher'
import type { EnrichedTransaction } from '../types'

describe('matchAmount', () => {
  it('compares the absolute amount with gte, lte, gt and lt bounds', () => {
    expect(matchAmount('-100.00', 'gte', '100')).toBe(true)
    expect(matchAmount('99.99', 'gte', '100')).toBe(false)
    expect(matchAmount('100.00', 'lte', '100')).toBe(true)
    expect(matchAmount('100.01', 'lte', '100')).toBe(false)
    expect(matchAmount('100.00', 'gt', '100')).toBe(false)
    expect(matchAmount('100.01', 'gt', '100')).toBe(true)
    expect(matchAmount('99.99', 'lt', '100')).toBe(true)
    expect(matchAmount('100', 'lt', '100')).toBe(false)
  })

  it('includes both bounds of between, also with bounds of more than two decimals', () => {
    expect(matchAmount('95.00', 'between', '95', '105')).toBe(true)
    expect(matchAmount('105.00', 'between', '95', '105')).toBe(true)
    expect(matchAmount('105.01', 'between', '95', '105')).toBe(false)
    // Bounds written by an older 5% tolerance (100 * 0.95 in floating point)
    expect(matchAmount('95.00', 'between', '94.99999999999999', '105.00000000000001')).toBe(true)
    expect(matchAmount('94.99', 'between', '94.99999999999999', '105.00000000000001')).toBe(false)
    expect(matchAmount('95.00', 'between', '95.000001', '105')).toBe(false)
  })

  it('reads a French decimal comma and spaces that parseFloat cut short', () => {
    // parseFloat("12,50") is 12 and parseFloat("1 234,56") is 1
    expect(matchAmount('12.20', 'gte', '12,50')).toBe(false)
    expect(matchAmount('12.50', 'gte', '12,50')).toBe(true)
    expect(matchAmount('5.00', 'gte', '1 234,56')).toBe(false)
    expect(matchAmount('1234.56', 'equals', '1 234,56')).toBe(true)
  })

  it('matches equals to the cent, without floating point noise', () => {
    expect(matchAmount(0.1 + 0.2, 'equals', '0.30')).toBe(true)
    expect(matchAmount('100.00', 'equals', '100')).toBe(true)
    expect(matchAmount('100.01', 'equals', '100')).toBe(false)
    expect(matchAmount('100.00', 'equals', '100.004')).toBe(true)
    expect(matchAmount('100.00', 'equals', '-100')).toBe(false)
  })

  it('never matches an unreadable bound or amount', () => {
    expect(matchAmount('100', 'gte', 'abc')).toBe(false)
    expect(matchAmount('100', 'between', '10', 'beaucoup')).toBe(false)
    expect(matchAmount('100', 'equals', '')).toBe(false)
    expect(matchAmount('n/a', 'gte', '0')).toBe(false)
  })

  it('stays exact for amounts at the top of Decimal(15, 2)', () => {
    expect(matchAmount('9999999999999.99', 'gte', '9999999999999.98')).toBe(true)
    expect(matchAmount('9999999999999.98', 'gte', '9999999999999.99')).toBe(false)
  })
})

describe('rule-builder amount tolerance', () => {
  const transaction = (amount: string) =>
    ({ amount: { toString: () => amount } }) as unknown as Parameters<typeof extractConditionsFromTransaction>[0]

  it('writes the 5% tolerance as bounds in cents', () => {
    const [condition] = extractConditionsFromTransaction(transaction('-100.00'))
    expect(condition).toMatchObject({ conditionType: 'amount', operator: 'between', value: '95.00', value2: '105.00' })
  })

  it('rounds the bounds inward to the cent so a cent amount matches as before', () => {
    // 0.95 * 10.01 = 9.5095 and 1.05 * 10.01 = 10.5105
    const [condition] = extractConditionsFromTransaction(transaction('10.01'))
    expect(condition).toMatchObject({ value: '9.51', value2: '10.51' })
    expect(matchAmount('9.51', 'between', condition.value!, condition.value2)).toBe(true)
    expect(matchAmount('9.50', 'between', condition.value!, condition.value2)).toBe(false)
    expect(matchAmount('10.52', 'between', condition.value!, condition.value2)).toBe(false)
  })
})

describe('findMatchingRules with an amount condition', () => {
  const rule = (operator: string, value: string, value2: string | null = null) =>
    ({
      id: 'r1',
      name: 'Loyer',
      conditions: [{ id: 'c1', conditionType: 'amount', operator, value, value2 }],
    }) as unknown as RuleWithConditions
  const tx = (amount: string) => ({ amount: { toString: () => amount } }) as unknown as EnrichedTransaction

  it('matches the rule when the transaction is in range', () => {
    expect(findMatchingRules([rule('between', '1000', '1200,50')], tx('-1200.50'))).toHaveLength(1)
    expect(findMatchingRules([rule('between', '1000', '1200,50')], tx('-1200.51'))).toHaveLength(0)
  })
})
