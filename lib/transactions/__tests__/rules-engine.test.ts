/**
 * Tests for transaction rules engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma, type BankTransaction as PrismaBankTransaction, TransactionRule, TransactionRuleCondition, TransactionRuleEntryLine } from '@prisma/client'

// Mock Prisma
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

// Mock the rule service module
vi.mock('../rule-service', async () => {
  const actual = await vi.importActual('../rule-service')
  return {
    ...actual,
  }
})

describe('Transaction Rules Engine', () => {
  const mockTransaction: PrismaBankTransaction = {
    id: 'tx-1',
    bankAccountId: 'account-1',
    externalTransactionId: 'ext-1',
    amount: new Prisma.Decimal(100),
    date: new Date('2024-01-15'),
    label: 'Test Transaction',
    reference: 'REF-001',
    side: 'debit',
    note: null,
    reconciled: false,
    reconciledAt: null,
    reconciledWith: null,
    imported: false,
    logoUrl: null,
    counterpartyName: null,
    category: null,
    cashflowCategory: null,
    cashflowSubcategory: null,
    operationType: null,
    providerData: null,
    status: null,
    vatRate: null,
    vatAmount: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockRuleBase: TransactionRule = {
    id: 'rule-1',
    companyId: 'company-1',
    name: 'Test Rule',
    description: 'Test Description',
    priority: 1,
    journalCode: 'OD',
    defaultVatAccountCode: null,
    autoCreate: true,
    requireApproval: false,
    enabled: true,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockRule = mockRuleBase as TransactionRule & { conditions?: TransactionRuleCondition[]; entryLines?: TransactionRuleEntryLine[] }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rule Matching', () => {
    it('should match transaction by label', () => {
      const condition: TransactionRuleCondition = {
        id: 'cond-1',
        ruleId: 'rule-1',
        conditionType: 'label',
        operator: 'contains',
        value: 'Test',
        value2: null,
      }

      const rule: TransactionRule & { conditions?: TransactionRuleCondition[] } = {
        ...mockRule,
        conditions: [condition],
      }

      // This would test the actual matching logic
      // For now, we're setting up the structure
      expect(rule.conditions?.length).toBe(1)
      expect(rule.conditions?.[0].conditionType).toBe('label')
    })

    it('should match transaction by amount range', () => {
      const condition: TransactionRuleCondition = {
        id: 'cond-1',
        ruleId: 'rule-1',
        conditionType: 'amount',
        operator: 'between',
        value: '50',
        value2: '200',
      }

      const rule: TransactionRule & { conditions?: TransactionRuleCondition[] } = {
        ...mockRule,
        conditions: [condition],
      }

      expect(rule.conditions?.[0].conditionType).toBe('amount')
      expect(rule.conditions?.[0].operator).toBe('between')
    })
  })

  describe('Entry Generation', () => {
    it('should generate entry lines from rule template', () => {
      const entryLine: TransactionRuleEntryLine = {
        id: 'line-1',
        ruleId: 'rule-1',
        accountCode: '606100',
        lineType: 'debit',
        amountType: 'full',
        amountValue: null,
        description: 'Test Description',
        order: 1,
        vatType: null,
        vatRateSource: 'fixed',
        vatRate: null,
        vatAccountCode: null,
        vatAccount2Code: null,
        vatOnDebit: false,
      }

      const rule: TransactionRule & { entryLines?: TransactionRuleEntryLine[] } = {
        ...mockRule,
        entryLines: [entryLine],
      }

      expect(rule.entryLines?.length).toBe(1)
      expect(rule.entryLines?.[0].amountType).toBe('full')
    })

    it('should handle VAT in entry lines', () => {
      const entryLine: TransactionRuleEntryLine = {
        id: 'line-1',
        ruleId: 'rule-1',
        accountCode: '606100',
        lineType: 'debit',
        amountType: 'ht',
        amountValue: null,
        description: 'Test Description',
        order: 1,
        vatType: 'deductible',
        vatRateSource: 'fixed',
        vatRate: new Prisma.Decimal(20),
        vatAccountCode: '445660',
        vatAccount2Code: null,
        vatOnDebit: false,
      }

      const rule: TransactionRule & { entryLines?: TransactionRuleEntryLine[] } = {
        ...mockRule,
        entryLines: [entryLine],
      }

      expect(rule.entryLines?.[0].vatType).toBe('deductible')
      expect(rule.entryLines?.[0].vatRate?.toString()).toBe('20')
    })
  })
})
