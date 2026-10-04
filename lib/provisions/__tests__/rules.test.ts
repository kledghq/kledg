/**
 * Rules of provisions and impairments (lib/provisions/rules.ts), with the
 * figures of worked examples.
 *
 * Sources: PCG art. 322-1 et seq. (provisions reviewed at each closing),
 * art. 214-15 et seq. (impairment to the current value), art. 214-19
 * (goodwill impairments never reversed); chart of accounts as amended by
 * ANC 2022-06 (151, 152, 29, 39, 49, 59, 681 to 687, 781 to 787); CGI art.
 * 39, 1-5° and 39, 2 (deductibility); CGI art. 272, 1 (VAT of a lost
 * receivable recovered: impairment on the amount excluding tax).
 */

import { describe, expect, it } from 'vitest'
import {
  ALLOWANCE_ACCOUNTS,
  allowedNatures,
  defaultNature,
  defaultTaxDeductible,
  fixedAssetImpairmentCents,
  impairmentAccountOfAsset,
  isAllowanceAccountOf,
  isGoodwillImpairment,
  movementAccounts,
  movementLines,
  movementTo,
  PROVISION_CATEGORIES,
  receivableBaseExclTaxCents,
  shareCents,
} from '../rules'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'

const CHART = new Map(PCG_ACCOUNTS.map((a) => [a.code, a.label]))

describe('allowance accounts', () => {
  it('offers only accounts of the 2025 chart, with their official labels', () => {
    for (const category of PROVISION_CATEGORIES) {
      for (const account of ALLOWANCE_ACCOUNTS[category]) {
        expect(CHART.get(account.code), account.code).toBe(account.label)
        expect(isAllowanceAccountOf(category, account.code), account.code).toBe(true)
      }
    }
  })

  it('checks the account against the category', () => {
    expect(isAllowanceAccountOf('RISK_CHARGE', '1511')).toBe(true)
    expect(isAllowanceAccountOf('RISK_CHARGE', '1525')).toBe(true)
    // 153 to 158 belonged to the former chart; 14 holds regulated provisions
    expect(isAllowanceAccountOf('RISK_CHARGE', '153')).toBe(false)
    expect(isAllowanceAccountOf('RISK_CHARGE', '145')).toBe(false)
    expect(isAllowanceAccountOf('FIXED_ASSET', '2815')).toBe(false)
    expect(isAllowanceAccountOf('FIXED_ASSET', '2915')).toBe(true)
    expect(isAllowanceAccountOf('RECEIVABLE', '491000')).toBe(true)
    expect(isAllowanceAccountOf('RECEIVABLE', '411')).toBe(false)
    expect(isAllowanceAccountOf('SECURITY', '590')).toBe(true)
    expect(isAllowanceAccountOf('INVENTORY', '39 7')).toBe(false)
  })

  it('derives the impairment account of a fixed asset account', () => {
    expect(impairmentAccountOfAsset('2154')).toBe('2915')
    expect(impairmentAccountOfAsset('2183')).toBe('2918')
    expect(impairmentAccountOfAsset('207')).toBe('2907')
    expect(impairmentAccountOfAsset('2611')).toBe('2961')
    expect(impairmentAccountOfAsset('2741')).toBe('2974')
    expect(impairmentAccountOfAsset('2813')).toBeNull()
    for (const code of ['2915', '2918', '2907', '2961', '2974']) expect(CHART.has(code), code).toBe(true)
  })
})

describe('dotation and reprise accounts', () => {
  const codes = (category: Parameters<typeof movementAccounts>[0], account: string, nature: Parameters<typeof movementAccounts>[2]) => {
    const a = movementAccounts(category, account, nature)
    return [a.dotation.code, a.reprise.code]
  }

  it('books provisions for risks and charges to 6815 / 7815, or financial and exceptional ones', () => {
    expect(codes('RISK_CHARGE', '1511', 'OPERATING')).toEqual(['6815', '7815'])
    expect(codes('RISK_CHARGE', '1515', 'FINANCIAL')).toEqual(['6865', '7865'])
    expect(codes('RISK_CHARGE', '1522', 'EXCEPTIONAL')).toEqual(['6875', '7875'])
  })

  it('books impairments to the sub-account of their category', () => {
    expect(codes('FIXED_ASSET', '2907', 'OPERATING')).toEqual(['68161', '78161'])
    expect(codes('FIXED_ASSET', '2915', 'OPERATING')).toEqual(['68162', '78162'])
    expect(codes('FIXED_ASSET', '2961', 'FINANCIAL')).toEqual(['68662', '78662'])
    expect(codes('FIXED_ASSET', '2918', 'EXCEPTIONAL')).toEqual(['6876', '7876'])
    expect(codes('INVENTORY', '397', 'OPERATING')).toEqual(['68173', '78173'])
    expect(codes('RECEIVABLE', '491', 'OPERATING')).toEqual(['68174', '78174'])
    expect(codes('RECEIVABLE', '4955', 'FINANCIAL')).toEqual(['6866', '7866'])
    expect(codes('SECURITY', '5903', 'FINANCIAL')).toEqual(['68665', '78665'])
  })

  it('uses only accounts of the chart', () => {
    for (const category of PROVISION_CATEGORIES) {
      for (const account of ALLOWANCE_ACCOUNTS[category]) {
        for (const nature of allowedNatures(category, account.code)) {
          const a = movementAccounts(category, account.code, nature)
          expect(CHART.get(a.dotation.code), a.dotation.code).toBe(a.dotation.label)
          expect(CHART.get(a.reprise.code), a.reprise.code).toBe(a.reprise.label)
        }
      }
    }
  })

  it('falls back on the default nature when the category does not allow the one given', () => {
    expect(allowedNatures('FIXED_ASSET', '2961')).toEqual(['FINANCIAL', 'EXCEPTIONAL'])
    expect(codes('FIXED_ASSET', '2961', 'OPERATING')).toEqual(['68662', '78662'])
    expect(codes('SECURITY', '5908', 'OPERATING')).toEqual(['68665', '78665'])
    expect(defaultNature('RISK_CHARGE', '1515')).toBe('FINANCIAL')
    expect(defaultNature('RISK_CHARGE', '1511')).toBe('OPERATING')
    expect(defaultNature('RECEIVABLE', '4955')).toBe('FINANCIAL')
    expect(defaultNature('INVENTORY', '397')).toBe('OPERATING')
  })
})

describe('movements', () => {
  it('books a dotation, then a reprise when the risk decreases (PCG art. 322-1 et seq.)', () => {
    // Litigation: 12 000 € required at the 2026 closing, 4 000 € at the 2027 closing
    const first = movementTo(1_200_000, 0, true)
    expect(first).toEqual({ cents: 1_200_000, reversalRefused: false })
    const accounts = movementAccounts('RISK_CHARGE', '1511', 'OPERATING')
    expect(movementLines(first.cents, { code: '1511', label: 'Provisions pour litiges' }, accounts)).toEqual([
      { code: '6815', label: "Dotations aux provisions d'exploitation", debitCents: 1_200_000, creditCents: 0 },
      { code: '1511', label: 'Provisions pour litiges', debitCents: 0, creditCents: 1_200_000 },
    ])
    const second = movementTo(400_000, 1_200_000, true)
    expect(second.cents).toBe(-800_000)
    expect(movementLines(second.cents, { code: '1511', label: 'Provisions pour litiges' }, accounts)).toEqual([
      { code: '1511', label: 'Provisions pour litiges', debitCents: 800_000, creditCents: 0 },
      { code: '7815', label: "Reprises sur provisions d'exploitation", debitCents: 0, creditCents: 800_000 },
    ])
    expect(movementTo(400_000, 400_000, true).cents).toBe(0)
    expect(movementLines(0, { code: '1511', label: 'x' }, accounts)).toEqual([])
  })

  it('never reverses an impairment of goodwill (PCG art. 214-19)', () => {
    expect(isGoodwillImpairment('2907')).toBe(true)
    expect(isGoodwillImpairment('2905')).toBe(false)
    expect(movementTo(100_000, 500_000, false)).toEqual({ cents: 0, reversalRefused: true })
    // An increase is still booked
    expect(movementTo(700_000, 500_000, false)).toEqual({ cents: 200_000, reversalRefused: false })
  })

  it('writes a fixed asset down to its current value (PCG art. 214-15 et seq.)', () => {
    // Net book value 30 000 €, current value 22 000 €: impairment 8 000 €
    expect(fixedAssetImpairmentCents(3_000_000, 2_200_000)).toBe(800_000)
    // Current value above the net book value: no impairment
    expect(fixedAssetImpairmentCents(3_000_000, 3_500_000)).toBe(0)
  })

  it('writes a doubtful receivable down on its amount excluding tax (CGI art. 272, 1)', () => {
    // 1 200 € including 20 % VAT: base 1 000 €, 50 % probable loss: 500 €
    const base = receivableBaseExclTaxCents(120_000, 2_000)
    expect(base).toBe(100_000)
    expect(shareCents(base, 5_000)).toBe(50_000)
    // 5,5 %: 1 055 € gives 1 000 €
    expect(receivableBaseExclTaxCents(105_500, 550)).toBe(100_000)
    // No VAT (exempt sale)
    expect(receivableBaseExclTaxCents(99_999, 0)).toBe(99_999)
    // Rounded to the cent: 100 € at 20 % is 83,33 €
    expect(receivableBaseExclTaxCents(10_000, 2_000)).toBe(8_333)
    expect(() => receivableBaseExclTaxCents(10_000, -1)).toThrow(RangeError)
  })
})

describe('deductibility (CGI art. 39)', () => {
  it('treats fines and retirement allowances as not deductible by default', () => {
    expect(defaultTaxDeductible('1514')).toBe(false)
    expect(defaultTaxDeductible('1521')).toBe(false)
    expect(defaultTaxDeductible('1511')).toBe(true)
    expect(defaultTaxDeductible('1512')).toBe(true)
  })
})
