/**
 * The tax drafts Kledg prepares and closed periods (booking-day.ts, R3
 * QUAL-09): which references are Kledg's, and the day a draft is booked on.
 * BOI-BIC-DECLA-30-10-20-40 § 140: an operation of a closed period is
 * booked on the first day of the open period, with its real date.
 */

import { describe, expect, it } from 'vitest'
import { bookingDayInTx, isKledgTaxDraftReference, movedDraftNote } from '../booking-day'

const tx = (periodLockedThrough: string | null) =>
  ({ fiscalYear: { findUnique: async () => ({ periodLockedThrough: periodLockedThrough ? new Date(`${periodLockedThrough}T00:00:00Z`) : null }) } }) as never

describe('tax drafts of Kledg in closed periods', () => {
  it('recognises the references Kledg gives its tax drafts, and only those', () => {
    for (const reference of ['TVA-CA3-2026-09', 'TVA-CA3-2026-T3', 'TVA-CA12-2026', 'COEF-TVA-2026', 'TS-2026', 'IS-2026', 'IS-AC-2026-2', 'CFE-2026-AC', 'CFE-2026-SOLDE']) {
      expect(isKledgTaxDraftReference(reference), reference).toBe(true)
    }
    for (const reference of [null, '', 'F-2026-12', 'TVA-MANUELLE', 'IS-RECTIF', 'TS-2026-bis']) {
      expect(isKledgTaxDraftReference(reference), String(reference)).toBe(false)
    }
  })

  it('books on the natural day while it is open, else on the first open day with the real date as the document date', async () => {
    expect(await bookingDayInTx(tx(null), 'fy', '2026-09-30')).toEqual({ date: '2026-09-30', pieceDate: null })
    expect(await bookingDayInTx(tx('2026-08-31'), 'fy', '2026-09-30')).toEqual({ date: '2026-09-30', pieceDate: null })
    const moved = await bookingDayInTx(tx('2026-09-30'), 'fy', '2026-09-30')
    expect(moved).toEqual({ date: '2026-10-01', pieceDate: '2026-09-30' })
    expect(movedDraftNote(moved)).toBe("La période est clôturée jusqu'au 30/09/2026 : l'écriture est datée du 01/10/2026, premier jour ouvert, avec sa date réelle (30/09/2026) en date de pièce (PCG art. 1031-4).")
  })
})
