/**
 * The réel simplifié of VAT ends on 31 December 2026: from 1 January 2027 a
 * company files under the réel normal (CA3) or the franchise en base (loi
 * n° 2025-127 du 14 février 2025, art. 38). The CA12 of 2026 is the last
 * one, and no acompte of July and December is due after it (#142).
 */
export const SIMPLIFIED_VAT_LAST_YEAR = 2026

/** True when the CA12 of a period ending on `endDay` is the last one: no acompte follows it. */
export function lastSimplifiedReturn(endDay: string): boolean {
  return Number(endDay.slice(0, 4)) >= SIMPLIFIED_VAT_LAST_YEAR
}
