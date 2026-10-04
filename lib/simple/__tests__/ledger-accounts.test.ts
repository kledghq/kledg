import { describe, expect, it } from 'vitest'
import { pickLedgerAccount } from '../ledger-accounts'

const chart = (...codes: string[]) => codes.map((code) => ({ id: `id-${code}`, code, label: code }))

describe('pickLedgerAccount', () => {
  it('takes the exact account first', () => {
    expect(pickLedgerAccount('626', chart('626', '626000'))?.code).toBe('626')
  })

  it('takes the detailed account padded with zeros, else the lowest one (FEC charts)', () => {
    expect(pickLedgerAccount('626', chart('626100', '626000'))?.code).toBe('626000')
    expect(pickLedgerAccount('626', chart('626200', '626100'))?.code).toBe('626100')
  })

  it('falls back on the closest parent, never on an unrelated account', () => {
    expect(pickLedgerAccount('6511', chart('651', '65'))?.code).toBe('651')
    expect(pickLedgerAccount('6511', chart('6512'))).toBeNull()
    expect(pickLedgerAccount('53', chart('512'))).toBeNull()
  })
})
