/**
 * Deadline of the bilan pédagogique et financier (Code du travail
 * R6352-23): sent "avant le 30 avril de chaque année" for the last closed
 * fiscal year, so 29 April at the latest, the cautious reading. The ministry
 * extends the campaign each year by announcement, never by a text: in 2026
 * until 31 May (DREETS, campagne 2026). Only announced extensions are listed
 * here. Pure.
 */

/** Campaign extensions announced by the administration, by filing year. */
export const BPF_EXTENSIONS: Record<number, string> = { 2026: '2026-05-31' }

/** The BPF of the fiscal year ending on `endDate` is filed the following year. */
export function bpfDeadlineOf(endDate: string): { date: string; extendedDate: string | null } {
  const year = Number(endDate.slice(0, 4)) + 1
  return { date: `${year}-04-29`, extendedDate: BPF_EXTENSIONS[year] ?? null }
}
