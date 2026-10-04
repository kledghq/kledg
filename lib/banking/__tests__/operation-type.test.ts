import { describe, expect, it } from 'vitest'

import { operationTypeLabel } from '../operation-type'

describe('operationTypeLabel', () => {
  it('translates the provider codes shown on the reconciliation screen', () => {
    expect(operationTypeLabel('transfer')).toBe('Virement')
    expect(operationTypeLabel('card')).toBe('Carte')
    expect(operationTypeLabel('direct_debit')).toBe('Prélèvement')
    expect(operationTypeLabel('income')).toBe('Virement reçu')
    expect(operationTypeLabel('qonto_fee')).toBe('Frais bancaires')
  })

  it('ignores case and surrounding spaces', () => {
    expect(operationTypeLabel(' Card ')).toBe('Carte')
  })

  it('turns an unknown code into words instead of hiding it', () => {
    expect(operationTypeLabel('loan_repayment')).toBe('Loan repayment')
  })

  it('returns null when there is no type', () => {
    expect(operationTypeLabel(null)).toBeNull()
    expect(operationTypeLabel(undefined)).toBeNull()
    expect(operationTypeLabel('  ')).toBeNull()
  })
})
