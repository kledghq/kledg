/**
 * The chart Kledg seeds follows the PCG as amended by règlement ANC
 * n° 2022-06 (mandatory for fiscal years opened from 1 January 2025): the
 * transferts de charges (79: 791, 796, 797) were removed; what they recorded
 * now goes to the account of its nature (7587 insurance indemnities, 649
 * reimbursements of personnel costs, or a reduction of the charge itself).
 * Source: règlement ANC n° 2022-06 du 4 novembre 2022, homologated by
 * arrêté du 26 décembre 2022; PCG art. 932-1 (liste des comptes) in force
 * for 2025 and 2026.
 */

import { describe, expect, it } from 'vitest'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { checkPCGAccountStructureCompliance } from '@/lib/accounting/pcg-compliance-checker'

describe('PCG chart after ANC 2022-06', () => {
  it('seeds no transferts de charges account (79)', () => {
    expect(PCG_ACCOUNTS.filter((a) => a.code.startsWith('79')).map((a) => a.code)).toEqual([])
  })

  it('keeps the accounts that replace them', () => {
    const codes = new Set(PCG_ACCOUNTS.map((a) => a.code))
    for (const code of ['7587', '649', '657', '757', '672', '772']) expect(codes.has(code), code).toBe(true)
  })

  it('does not require 79 in the minimal chart', () => {
    const result = checkPCGAccountStructureCompliance()
    expect(result.stats.missingRequiredAccounts).not.toContain('79')
  })
})
