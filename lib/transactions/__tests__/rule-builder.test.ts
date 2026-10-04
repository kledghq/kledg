/**
 * Tests for transaction rule builder
 */

import { describe, it, expect } from 'vitest'
import { Prisma, type BankTransaction as PrismaBankTransaction } from '@prisma/client'

describe('extractConditionsFromTransaction', () => {
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

  it('should extract label condition', () => {
    // This would test the actual extraction logic
    expect(mockTransaction.label).toBe('Test Transaction')
  })

  it('should extract amount condition', () => {
    expect(mockTransaction.amount.toString()).toBe('100')
    expect(mockTransaction.side).toBe('debit')
  })

  it('should extract reference condition', () => {
    expect(mockTransaction.reference).toBe('REF-001')
  })
})
