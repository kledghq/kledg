import { describe, expect, it } from 'vitest'
import { MANUAL_ACCOUNT_ID_PREFIX, selectAccountTransactions } from '../importer'
import type { ParseResult } from '../types'

/** An OFX statement of account 98765432101 with one line. */
const statement: ParseResult = {
  format: 'ofx',
  transactions: [{ bookingDate: '2026-03-02', amountCents: 144000, label: 'CLIENT EXEMPLE', account: '98765432101', line: 1 }],
  errors: [],
  warnings: [],
  accounts: [],
}

describe('selectAccountTransactions', () => {
  it('imports into a manual account without IBAN without asking: its random id names no bank account', () => {
    const result = selectAccountTransactions(statement, {
      id: 'a',
      iban: null,
      externalAccountId: `${MANUAL_ACCOUNT_ID_PREFIX}6f1c0d1e-0000-4000-8000-000000000000`,
      currency: 'EUR',
    })
    expect(result.errors).toEqual([])
    expect(result.transactions).toHaveLength(1)
  })

  it('still asks when the IBAN of a manual account does not match the file', () => {
    const result = selectAccountTransactions(statement, {
      id: 'a',
      iban: 'FR7612345000010000000000123',
      externalAccountId: `${MANUAL_ACCOUNT_ID_PREFIX}6f1c0d1e-0000-4000-8000-000000000000`,
      currency: 'EUR',
    })
    expect(result.errors[0]?.message).toBe(
      'Ce relevé concerne le compte 98765432101, qui ne correspond pas au compte sélectionné (FR7612345000010000000000123).',
    )
  })
})
