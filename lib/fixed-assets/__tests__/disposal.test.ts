/**
 * Gain or loss on the exit of a fixed asset and its tax character
 * (lib/fixed-assets/disposal.ts). Sources: CGI art. 39 duodecies (IR),
 * art. 219, I-a ter (IS: long term for titres de participation only),
 * notice 2033-NOT-SD 2026, cadre III; PCG chart amended by règlement ANC
 * n° 2022-06 (657, 757, 462).
 */

import { describe, expect, it } from 'vitest'
import { computeDisposal, disposalEntryLines, isDisposableAssetAccount, isDisposalKind } from '../disposal'

const base = {
  grossCents: 1_200_000,
  depreciationCents: 900_000,
  acquisitionDate: '2022-03-15',
  disposalDate: '2026-06-30',
  depreciable: true,
}

describe('computeDisposal', () => {
  it('gives the net book value and the gain: price less (gross less depreciation)', () => {
    const r = computeDisposal({ ...base, priceCents: 500_000, taxation: 'IS' })
    expect(r.netBookValueCents).toBe(300_000)
    expect(r.gainCents).toBe(200_000)
  })

  it('keeps every gain or loss short term under IS (long term is for titres only)', () => {
    const gain = computeDisposal({ ...base, priceCents: 500_000, taxation: 'IS' })
    expect(gain).toMatchObject({ shortTermCents: 200_000, longTermCents: 0 })
    expect(gain.explanation).toContain('219')
    const land = computeDisposal({ ...base, depreciable: false, depreciationCents: 0, priceCents: 2_000_000, taxation: 'IS' })
    expect(land).toMatchObject({ gainCents: 800_000, shortTermCents: 800_000, longTermCents: 0 })
  })

  it('under IR, a depreciable asset held two years: short term up to the depreciation, long term beyond', () => {
    const r = computeDisposal({ ...base, priceCents: 1_500_000, taxation: 'IR' })
    // gain 1 200 000; depreciation deducted 900 000
    expect(r).toMatchObject({ gainCents: 1_200_000, heldTwoYears: true, shortTermCents: 900_000, longTermCents: 300_000 })
    const small = computeDisposal({ ...base, priceCents: 500_000, taxation: 'IR' })
    expect(small).toMatchObject({ shortTermCents: 200_000, longTermCents: 0 })
  })

  it('under IR, a loss on a depreciable asset held two years is short term', () => {
    expect(computeDisposal({ ...base, priceCents: 100_000, taxation: 'IR' })).toMatchObject({ gainCents: -200_000, shortTermCents: -200_000, longTermCents: 0 })
  })

  it('under IR, a non-depreciable asset held two years gives long term, gain or loss', () => {
    const nd = { ...base, depreciable: false, depreciationCents: 0 }
    expect(computeDisposal({ ...nd, priceCents: 1_500_000, taxation: 'IR' })).toMatchObject({ shortTermCents: 0, longTermCents: 300_000 })
    expect(computeDisposal({ ...nd, priceCents: 1_000_000, taxation: 'IR' })).toMatchObject({ shortTermCents: 0, longTermCents: -200_000 })
  })

  it('under IR, an asset held less than two years gives short term only', () => {
    const r = computeDisposal({ ...base, disposalDate: '2024-03-14', priceCents: 1_500_000, taxation: 'IR' })
    expect(r).toMatchObject({ heldTwoYears: false, shortTermCents: 1_200_000, longTermCents: 0 })
    // Two years to the day
    expect(computeDisposal({ ...base, disposalDate: '2024-03-15', priceCents: 0, taxation: 'IR' }).heldTwoYears).toBe(true)
    // Acquired on 29 February: held two years from 1 March
    const leap = { ...base, acquisitionDate: '2024-02-29', priceCents: 0, taxation: 'IR' as const }
    expect(computeDisposal({ ...leap, disposalDate: '2026-02-28' }).heldTwoYears).toBe(false)
    expect(computeDisposal({ ...leap, disposalDate: '2026-03-01' }).heldTwoYears).toBe(true)
  })

  it('a retirement without price loses the net book value; unknown taxation splits nothing', () => {
    const r = computeDisposal({ ...base, priceCents: 0, taxation: 'unknown' })
    expect(r).toMatchObject({ gainCents: -300_000, shortTermCents: null, longTermCents: null })
    expect(r.explanation).toContain("n'est pas renseigné")
  })
})

describe('disposalEntryLines', () => {
  const accounts = { asset: { code: '2182', label: 'Matériel de transport' }, depreciation: { code: '28182', label: 'Amortissements du matériel de transport' } }

  it('takes back the depreciation and the gross value, the net book value to 657, the price to 462 and 757', () => {
    const lines = disposalEntryLines({ ...accounts, grossCents: 1_200_000, depreciationCents: 900_000, priceCents: 500_000, withPrice: true })
    expect(lines.map((l) => [l.code, l.debitCents, l.creditCents])).toEqual([
      ['28182', 900_000, 0],
      ['657', 300_000, 0],
      ['2182', 0, 1_200_000],
      ['462', 500_000, 0],
      ['757', 0, 500_000],
    ])
    const debit = lines.reduce((t, l) => t + l.debitCents, 0)
    expect(debit).toBe(lines.reduce((t, l) => t + l.creditCents, 0))
  })

  it('leaves the price out when a sale invoice books it, and skips empty lines', () => {
    const lines = disposalEntryLines({ ...accounts, grossCents: 1_200_000, depreciationCents: 1_200_000, priceCents: 500_000, withPrice: false })
    expect(lines.map((l) => [l.code, l.debitCents, l.creditCents])).toEqual([
      ['28182', 1_200_000, 0],
      ['2182', 0, 1_200_000],
    ])
    const land = disposalEntryLines({ ...accounts, depreciation: null, grossCents: 800_000, depreciationCents: 0, priceCents: 0, withPrice: true })
    expect(land.map((l) => [l.code, l.debitCents, l.creditCents])).toEqual([
      ['657', 800_000, 0],
      ['2182', 0, 800_000],
    ])
  })
})

describe('accounts and kinds', () => {
  it('handles intangible and tangible assets only (20 to 23), and the three kinds', () => {
    expect(['2051', '2182', '213', '231'].every(isDisposableAssetAccount)).toBe(true)
    expect(['261', '2741', '28182'].some(isDisposableAssetAccount)).toBe(false)
    expect(['sale', 'scrap', 'destruction'].every(isDisposalKind)).toBe(true)
    expect(isDisposalKind('donation')).toBe(false)
  })
})
