/**
 * Default depreciation of the fixed assets simple mode creates
 * (lib/simple/asset-lifetimes.ts). Usual rates of BOI-BIC-AMT-10-40-30
 * (I-B and I-C): mobilier 10 % (10 years), outillage 10 to 20 % (5 to 10
 * years); computer equipment 3 years by usage; accounts of PCG art. 932-1
 * (2815, 2818, 6811), all seeded in every chart.
 */

import { describe, expect, it } from 'vitest'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { ASSET_LIFETIMES, assetLifetimeFor, DEPRECIATION_EXPENSE_ACCOUNT, fixedAssetMention } from '../asset-lifetimes'
import { SIMPLE_CATEGORIES } from '../categories'

describe('asset lifetimes of simple mode', () => {
  it('gives the usual useful life of each kind of durable equipment', () => {
    expect(ASSET_LIFETIMES.map((l) => [l.categoryId, l.assetAccount, l.depreciationAccount, l.years])).toEqual([
      ['materiel-informatique', '2183', '2818', 3],
      ['mobilier', '2184', '2818', 10],
      ['outillage', '2155', '2815', 5],
    ])
    expect(assetLifetimeFor('mobilier')?.years).toBe(10)
    expect(assetLifetimeFor('telephone-internet')).toBeNull()
    expect(assetLifetimeFor(null)).toBeNull()
  })

  it('stays within the usual rates of the tax administration, except computers (usage, 3 years)', () => {
    // BOI-BIC-AMT-10-40-30: mobilier 10 %, outillage 10 to 20 %
    expect(100 / assetLifetimeFor('mobilier')!.years).toBe(10)
    const tools = 100 / assetLifetimeFor('outillage')!.years
    expect(tools).toBeGreaterThanOrEqual(10)
    expect(tools).toBeLessThanOrEqual(20)
    for (const lifetime of ASSET_LIFETIMES) {
      expect(lifetime.source).toContain('BOI-BIC-AMT-10-40-30')
      expect(lifetime.source).toContain('PCG art. 214-1')
    }
  })

  it('covers every category whose answer books a fixed asset, on the answer account', () => {
    const durable = SIMPLE_CATEGORIES.flatMap((category) =>
      (category.question?.answers ?? []).filter((a) => a.posting.account?.startsWith('2')).map((a) => [category.id, a.posting.account]),
    )
    expect(durable).toEqual(ASSET_LIFETIMES.map((l) => [l.categoryId, l.assetAccount]))
  })

  it('uses depreciation accounts Kledg seeds in every chart', () => {
    const codes = new Set(PCG_ACCOUNTS.map((a) => a.code))
    for (const code of [DEPRECIATION_EXPENSE_ACCOUNT, ...ASSET_LIFETIMES.map((l) => l.depreciationAccount)]) expect(codes.has(code)).toBe(true)
  })

  it('writes the mention shown to the accountant', () => {
    expect(fixedAssetMention('Matériel informatique (Apple Store)', 3)).toBe('Immobilisation créée : Matériel informatique (Apple Store), amortie sur 3 ans')
    expect(fixedAssetMention('Perceuse', 1)).toBe('Immobilisation créée : Perceuse, amortie sur 1 an')
    expect(fixedAssetMention('Terrain', null)).toBe('Immobilisation créée : Terrain')
  })
})
