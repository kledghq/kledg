/**
 * Journals and references written by the fiscal year closing.
 *
 * - CL (Journal de clôture): on the last day of the closed year, one entry
 *   that brings every class 6 and 7 account to zero and books the result in
 *   120 (bénéfice) or 129 (perte). It records the closing in the books; the
 *   annual statements of that year are computed before it (they exclude it).
 * - AN (À-nouveaux): on the first day of the next year, one entry that
 *   brings forward the balance of every balance sheet account (classes 1 to
 *   5). It is part of the next year's figures.
 */

export const CLOSING_JOURNAL = { code: 'CL', label: 'Journal de clôture' } as const
export const OPENING_JOURNAL = { code: 'AN', label: 'À-nouveaux' } as const

/** Reference of the closing entry of a fiscal year ("CL-2025"). */
export function closingReference(year: number): string {
  return `CL-${year}`
}

/** Reference of the opening entry of a fiscal year ("AN-2026"). */
export function openingReference(year: number): string {
  return `AN-${year}`
}

/** Whether an entry is a closing entry (CL journal or a CL- reference). */
export function isClosingEntry(entry: {
  reference?: string | null
  journal?: { code: string } | null
}): boolean {
  if (entry.journal?.code === CLOSING_JOURNAL.code) return true
  return entry.reference?.startsWith('CL-') ?? false
}
