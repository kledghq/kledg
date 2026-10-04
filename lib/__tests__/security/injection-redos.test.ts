/**
 * ReDoS: regexes applied to user input must not allow catastrophic
 * backtracking that blocks the event loop.
 *
 * Two user-reachable regexes were singled out by code review, both fixed:
 * - lib/transactions/rule-matcher.ts compiled new RegExp(conditionValue) from
 *   a rule condition (KLEDG-SEC-001). Patterns now run on the linear-time
 *   matcher of lib/transactions/rule-regex.ts, are checked when a rule is
 *   saved and share a step budget per run.
 * - lib/import/fec/plan.ts cleanEntryNumber used a quadratic lookahead
 *   (KLEDG-SEC-004), now a linear scan.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { findMatchingRules, type RuleWithConditions } from '@/lib/transactions/rule-matcher'
import { createRule, findRulePatternIssues, updateRule, type RuleWithDetails } from '@/lib/transactions/manage-rules.service'
import { cleanEntryNumber } from '@/lib/import/fec/plan'
import type { EnrichedTransaction } from '@/lib/transactions/types'
import { NEW_FINDINGS } from './findings'

const db = asPrismaMock(prisma)

function ruleWithRegex(pattern: string): RuleWithConditions {
  return {
    id: 'rule-1',
    name: 'r',
    conditions: [{ conditionType: 'label', operator: 'regex', value: pattern }],
  } as unknown as RuleWithConditions
}

const txWithLabel = (label: string) => ({ label, amount: 0 }) as unknown as EnrichedTransaction

describe('rule-matcher: user-controlled regex surface', () => {
  it('runs a benign user regex against the transaction label quickly', () => {
    const start = performance.now()
    const matches = findMatchingRules([ruleWithRegex('^VIR .*')], txWithLabel('VIR SALAIRE'))
    expect(Array.isArray(matches)).toBe(true)
    expect(performance.now() - start).toBeLessThan(200)
  })

  it(`[KLEDG-SEC-001] fixed: ${NEW_FINDINGS['KLEDG-SEC-001'].title}`, () => {
    // A rule condition any accountant can create (also via MCP create_rule).
    // "(a+)+$" against a long non-matching label backtracked catastrophically
    // under new RegExp; the linear matcher resolves it well within the budget.
    for (const [pattern, label] of [
      ['(a+)+$', 'a'.repeat(40) + '!'],
      ['^(a+)+$', 'a'.repeat(10_000) + '!'],
      ['(.*a){12}', 'a'.repeat(5_000)],
      ['.*.*.*.*.*.*.*x', 'y'.repeat(10_000)],
    ] as const) {
      const start = performance.now()
      findMatchingRules([ruleWithRegex(pattern)], txWithLabel(label))
      expect(performance.now() - start, pattern).toBeLessThan(250)
    }
  })

  it('shares one step budget across the regex conditions of a run', () => {
    // 200 heavy rules against a long label: the budget stops the run instead of
    // letting the total grow with the number of rules.
    const rules = Array.from({ length: 200 }, () => ruleWithRegex('(.*){20}x'))
    const start = performance.now()
    expect(findMatchingRules(rules, txWithLabel('y'.repeat(5_000)))).toEqual([])
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('never throws on a stored pattern the matcher refuses (rule saved before the check)', () => {
    expect(findMatchingRules([ruleWithRegex('(a)\\1'), ruleWithRegex('(?=x)')], txWithLabel('aa'))).toEqual([])
    expect(findMatchingRules([ruleWithRegex('[')], txWithLabel('['))).toEqual([])
  })

  it('reports stored patterns the matcher refuses', () => {
    const rule = {
      id: 'rule-1',
      name: 'Ancienne règle',
      conditions: [
        { id: 'c1', conditionType: 'label', operator: 'regex', value: '(a)\\1' },
        { id: 'c2', conditionType: 'label', operator: 'regex', value: '^VIR' },
      ],
    } as unknown as RuleWithDetails
    expect(findRulePatternIssues([rule])).toEqual([
      { ruleId: 'rule-1', ruleName: 'Ancienne règle', conditionId: 'c1', message: expect.stringMatching(/références arrière/) },
    ])
  })

  it.each(['(a)\\1', '(?<=a)b', 'a'.repeat(301), '(a{100}){100}'])(
    'refuses to save a rule whose regex the linear matcher cannot run: %s',
    async (pattern) => {
      const input = { name: 'r', conditions: [{ conditionType: 'label', operator: 'regex', value: pattern }] }
      await expect(createRule('company-1', input)).rejects.toMatchObject({ name: 'ValidationError' })
      await expect(updateRule('company-1', 'rule-1', input)).rejects.toMatchObject({ name: 'ValidationError' })
      expect(db.transactionRule.create).not.toHaveBeenCalled()
      expect(db.$transaction).not.toHaveBeenCalled()
    },
  )
})

describe('FEC cleanEntryNumber', () => {
  it('keeps the last digit group normalized (correctness)', () => {
    expect(cleanEntryNumber('  42  ')).toBe('42')
    expect(cleanEntryNumber('FAC-0042')).toBe('FAC-42')
    expect(cleanEntryNumber('VT2026-0007')).toBe('VT2026-7')
    expect(cleanEntryNumber('0000')).toBe('0')
    expect(cleanEntryNumber('A-000')).toBe('A-0')
    expect(cleanEntryNumber('OD-007-B')).toBe('OD-7-B')
    expect(cleanEntryNumber('FAC')).toBe('FAC')
    expect(cleanEntryNumber('')).toBe('')
    expect(cleanEntryNumber('0'.repeat(30) + '12345678901234567890')).toBe('12345678901234567890')
  })

  it(`[KLEDG-SEC-004] fixed: ${NEW_FINDINGS['KLEDG-SEC-004'].title}`, () => {
    // The former /(\d+)(?!.*\d)/ was quadratic on a long digit/letter mix.
    for (const pathological of ['1a'.repeat(100_000), '1'.repeat(200_000) + 'a', 'a1'.repeat(100_000) + ' ']) {
      const start = performance.now()
      cleanEntryNumber(pathological)
      expect(performance.now() - start).toBeLessThan(250)
    }
  })
})
