/**
 * Conditions of the rules engine (lib/transactions/rule-matcher.ts): every
 * condition type and text operator, AND logic, confidence by number of
 * conditions, regex conditions through the linear-time compiler with a shared
 * step budget (KLEDG-SEC-001), and conditions on the attachments.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, type TransactionRuleCondition } from '@prisma/client'

vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { logger } from '@/lib/logger'
import { findMatchingRules, type RuleWithConditions } from '../rule-matcher'
import type { EnrichedTransaction } from '../types'

const transaction: EnrichedTransaction = {
  id: 'tx-1',
  bankAccountId: 'ba-1',
  externalTransactionId: 'ext-1',
  amount: new Prisma.Decimal('-42.50'),
  date: new Date('2025-03-15T00:00:00Z'),
  label: 'CB Papeterie MARTIN 14/03',
  reference: 'FAC-2025-118',
  side: 'debit',
  note: null,
  imported: false,
  reconciled: false,
  reconciledAt: null,
  reconciledWith: null,
  logoUrl: null,
  counterpartyName: 'Papeterie Martin',
  category: 'office_supplies',
  cashflowCategory: 'Frais généraux',
  cashflowSubcategory: 'Fournitures',
  operationType: 'card',
  vatRate: null,
  vatAmount: null,
  status: 'completed',
  providerData: null,
  createdAt: new Date('2025-03-15T00:00:00Z'),
  updatedAt: new Date('2025-03-15T00:00:00Z'),
  bankAccount: { name: 'Compte courant', iban: null },
}

let conditionId = 0
function condition(conditionType: string, operator: string, value: string | null, value2: string | null = null): TransactionRuleCondition {
  conditionId += 1
  return { id: `c-${conditionId}`, ruleId: 'r', conditionType, operator, value, value2 }
}

function rule(id: string, conditions: TransactionRuleCondition[], extra: Partial<RuleWithConditions> = {}): RuleWithConditions {
  return {
    id,
    companyId: 'company-1',
    name: `Règle ${id}`,
    description: null,
    enabled: true,
    priority: 0,
    journalCode: 'BQ',
    defaultVatAccountCode: null,
    autoCreate: false,
    requireApproval: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    conditions,
    ...extra,
  }
}

const matches = (conditions: TransactionRuleCondition[], tx: EnrichedTransaction = transaction) =>
  findMatchingRules([rule('r', conditions)], tx).length === 1

describe('findMatchingRules', () => {
  beforeEach(() => vi.mocked(logger.warn).mockClear())

  it.each([
    ['label', 'contains', 'papeterie'],
    ['label', 'startsWith', 'cb papeterie'],
    ['label', 'equals', 'CB PAPETERIE MARTIN 14/03'],
    ['reference', 'startsWith', 'FAC-2025'],
    ['counterparty', 'equals', 'papeterie martin'],
    ['category', 'equals', 'office_supplies'],
    ['cashflowCategory', 'contains', 'généraux'],
    ['cashflowSubcategory', 'equals', 'fournitures'],
    ['operationType', 'equals', 'card'],
    ['side', 'equals', 'debit'],
    ['status', 'equals', 'completed'],
  ])('matches %s %s "%s", ignoring case', (type, operator, value) => {
    expect(matches([condition(type, operator, value)])).toBe(true)
  })

  it.each([
    ['label', 'contains', 'boulangerie'],
    ['label', 'equals', 'CB Papeterie'],
    ['side', 'equals', 'credit'],
    ['label', 'unknownOperator', 'papeterie'],
    ['unknownType', 'equals', 'x'],
    ['label', 'contains', null],
  ])('does not match %s %s %s', (type, operator, value) => {
    expect(matches([condition(type, operator, value)])).toBe(false)
  })

  it('never matches a text condition when the transaction has no value for it', () => {
    const bare = { ...transaction, reference: null, counterpartyName: null, category: null, status: null, operationType: null }
    for (const type of ['reference', 'counterparty', 'category', 'status', 'operationType']) {
      expect(matches([condition(type, 'contains', 'a')], bare)).toBe(false)
    }
  })

  it('requires every condition (AND) and never matches a rule without conditions', () => {
    expect(matches([condition('label', 'contains', 'papeterie'), condition('side', 'equals', 'debit')])).toBe(true)
    expect(matches([condition('label', 'contains', 'papeterie'), condition('side', 'equals', 'credit')])).toBe(false)
    expect(matches([])).toBe(false)
  })

  it('rates confidence 0.5 + 0.1 per condition, capped at 0.95, and reports priority and autoCreate', () => {
    const one = rule('one', [condition('side', 'equals', 'debit')], { priority: 3, autoCreate: true })
    const many = rule('many', Array.from({ length: 6 }, () => condition('side', 'equals', 'debit')))
    expect(findMatchingRules([one, many], transaction)).toEqual([
      { ruleId: 'one', ruleName: 'Règle one', matched: true, confidence: 0.6, priority: 3, autoCreate: true },
      { ruleId: 'many', ruleName: 'Règle many', matched: true, confidence: 0.95, priority: 0, autoCreate: false },
    ])
  })

  it('compares amount conditions on the absolute amount in cents', () => {
    expect(matches([condition('amount', 'equals', '42,50')])).toBe(true)
    expect(matches([condition('amount', 'between', '40', '45')])).toBe(true)
    expect(matches([condition('amount', 'gt', '42.50')])).toBe(false)
    expect(matches([condition('amount', 'gte', null)])).toBe(false)
  })

  it('matches regex conditions case-insensitively through the safe compiler', () => {
    expect(matches([condition('label', 'regex', 'MARTIN \\d{2}/\\d{2}$')])).toBe(true)
    expect(matches([condition('label', 'regex', 'martin \\d{2}')])).toBe(true)
    expect(matches([condition('label', 'regex', '^martin')])).toBe(false)
  })

  it('treats a pattern the compiler refuses as not matching and warns once', () => {
    // Back-references are refused by the linear-time compiler
    const refused = condition('label', 'regex', '(a)\\1')
    expect(matches([refused])).toBe(false)
    expect(matches([refused])).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toBe('[Rules] Regex condition refused by the safe compiler, it never matches')
  })

  it('treats a regex test that runs out of the shared step budget as not matching', () => {
    const result = findMatchingRules([rule('r', [condition('label', 'regex', 'P.*MARTIN')])], transaction, { remaining: 1 })
    expect(result).toEqual([])
    expect(vi.mocked(logger.warn).mock.calls.map((c) => c[0])).toContain('[Rules] Regex step budget exhausted, condition treated as not matching')
  })

  it('matches attachment conditions on the presence of a supporting document', () => {
    const withDoc = { ...transaction, attachmentsCount: 2 }
    const viaArray = { ...transaction, attachments: [{ id: 'a' }] }
    expect(matches([condition('attachment', 'equals', 'yes')], withDoc)).toBe(true)
    expect(matches([condition('attachment', 'equals', 'yes')], viaArray)).toBe(true)
    expect(matches([condition('attachment', 'equals', 'no')], withDoc)).toBe(false)
    expect(matches([condition('attachment', 'equals', 'no')])).toBe(true)
    expect(matches([condition('attachment', 'equals', null)])).toBe(false)
  })
})
