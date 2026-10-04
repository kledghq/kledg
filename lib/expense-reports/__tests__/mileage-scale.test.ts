/**
 * Mileage allowances by the official scale (lib/expense-reports/mileage-scale.ts).
 * Source: arrêté du 27 mars 2023 (JORF du 7 avril 2023),
 * BOI-BAREME-000001-20230720; the same scale kept for 2024, 2025 and 2026
 * (URSSAF, Indemnités kilométriques). Electric vehicles: +20 %
 * (BOI-BAREME-000001). Figures below are computed by hand from the
 * published formulas.
 */

import { describe, expect, it } from 'vitest'
import { annualAllowanceCents, mileageAllowance, mileageScaleOf, MILEAGE_SCALES, powerClassOf } from '../mileage-scale'

const trip = (over: Partial<Parameters<typeof mileageAllowance>[0]> = {}) =>
  mileageAllowance({ year: 2026, vehicle: 'CAR', fiscalPower: 5, electric: false, distanceKm: 100, priorDistanceKm: 0, ...over })

describe('mileage scale per year', () => {
  it('knows the scales of 2022 to 2026, each with its source, and refuses any other year', () => {
    expect(Object.keys(MILEAGE_SCALES).map(Number)).toEqual([2022, 2023, 2024, 2025, 2026])
    for (const year of [2022, 2023, 2024, 2025, 2026]) expect(mileageScaleOf(year)?.source).toMatch(/Arrêté du 27 mars 2023/)
    expect(mileageScaleOf(2026)?.source).toMatch(/reconduit/)
    const unknown = trip({ year: 2027 })
    expect(unknown.ok).toBe(false)
    expect(unknown.ok ? '' : unknown.error).toMatch(/barème kilométrique 2027/)
    expect(trip({ year: 2021 }).ok).toBe(false)
  })

  it('applies the same car figures in 2024, 2025 and 2026 (scale kept unchanged)', () => {
    for (const year of [2024, 2025, 2026]) {
      // 5 CV, 100 km: 100 x 0,636 = 63,60 €
      expect(trip({ year })).toMatchObject({ ok: true, amountCents: 6_360, powerClass: '5 CV' })
    }
  })

  it('computes each car band: d x rate up to 5 000 km, d x rate + fixed up to 20 000 km, d x rate beyond', () => {
    const scale = mileageScaleOf(2026)!
    const three = powerClassOf(scale, 'CAR', 3)
    expect(annualAllowanceCents(three, 5_000, false)).toBe(264_500) // 5000 x 0,529
    expect(annualAllowanceCents(three, 12_000, false)).toBe(485_700) // 12000 x 0,316 + 1065
    expect(annualAllowanceCents(three, 25_000, false)).toBe(925_000) // 25000 x 0,370
    const seven = powerClassOf(scale, 'CAR', 11)
    expect(seven.label).toBe('7 CV et plus')
    expect(annualAllowanceCents(seven, 10_000, false)).toBe(545_500) // 10000 x 0,394 + 1515
    expect(powerClassOf(scale, 'CAR', 1).label).toBe('3 CV et moins')
  })

  it('pays motorcycles and mopeds by their own scale', () => {
    // Moto 3 to 5 CV, 4 000 km in the year: 4000 x 0,082 + 1158 = 1486 €
    const scale = mileageScaleOf(2026)!
    expect(annualAllowanceCents(powerClassOf(scale, 'MOTORCYCLE', 4), 4_000, false)).toBe(148_600)
    expect(powerClassOf(scale, 'MOTORCYCLE', 2).label).toBe('1 ou 2 CV')
    // Cyclomoteur 50 km: 50 x 0,315 = 15,75 €, no fiscal power needed
    expect(mileageAllowance({ year: 2026, vehicle: 'MOPED', fiscalPower: 0, electric: false, distanceKm: 50, priorDistanceKm: 0 })).toMatchObject({ ok: true, amountCents: 1_575 })
  })

  it('increases the amount by 20 % for an electric vehicle, rounded to the cent', () => {
    // 4 CV, 137 km: 137 x 0,606 = 83,022 € x 1,2 = 99,6264 -> 99,63 €
    expect(trip({ fiscalPower: 4, distanceKm: 137, electric: true })).toMatchObject({ ok: true, amountCents: 9_963 })
    expect(trip({ fiscalPower: 4, distanceKm: 137 })).toMatchObject({ ok: true, amountCents: 8_302 })
  })

  it('pays a trip the difference of the annual scale before and after it, so the trips of a year sum to the scale of its distance', () => {
    // 5 CV: 4 900 km already driven, then 300 km: scale(5200) - scale(4900)
    // = (5200 x 0,357 + 1395) - 4900 x 0,636 = 3251,40 - 3116,40 = 135,00 €
    expect(trip({ distanceKm: 300, priorDistanceKm: 4_900 })).toMatchObject({ ok: true, amountCents: 13_500 })
    const trips = [1_200, 3_800, 300, 9_000, 6_000]
    let prior = 0
    let paid = 0
    for (const distanceKm of trips) {
      const result = trip({ distanceKm, priorDistanceKm: prior })
      if (!result.ok) throw new Error(result.error)
      paid += result.amountCents
      prior += distanceKm
    }
    const scale = mileageScaleOf(2026)!
    expect(paid).toBe(annualAllowanceCents(powerClassOf(scale, 'CAR', 5), 20_300, false))
  })

  it('refuses a distance that is not a whole positive number and a car without fiscal power', () => {
    expect(trip({ distanceKm: 0 }).ok).toBe(false)
    expect(trip({ distanceKm: 12.5 }).ok).toBe(false)
    expect(trip({ fiscalPower: 0 }).ok).toBe(false)
  })
})
