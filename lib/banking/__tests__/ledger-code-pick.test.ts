import { describe, expect, it } from 'vitest'

import { pickLedgerCodeForBankAccount as pick } from '../ledger-code'

describe('pickLedgerCodeForBankAccount', () => {
  it('maps a euro account to 5121 in the default chart, never to 5124 (comptes en devises)', () => {
    expect(pick(['512', '5121', '5124'], null, 'EUR')).toBe('5121')
    expect(pick(['512', '5121', '5124'], null, 'USD')).toBe('5124')
  })

  it('prefers the default bank account for a euro account', () => {
    expect(pick(['5121', '512100', '5124'], '512100', 'eur')).toBe('512100')
  })

  it('leaves the choice explicit when several accounts fit', () => {
    expect(pick(['5121', '512100'], null, 'EUR')).toBeNull()
    expect(pick(['512'], null, 'EUR')).toBeNull()
    expect(pick(['5121'], null, 'GBP')).toBeNull()
  })
})
