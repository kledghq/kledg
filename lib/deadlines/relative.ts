/**
 * How far a deadline is from today, in words ("dans 5 jours",
 * "aujourd'hui", "en retard de 2 jours"). Pure, on calendar days.
 */

const DAY_MS = 86_400_000

/** Whole calendar days from `today` to `day` (negative when past). */
function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS)
}

export type DeadlineUrgency = 'past' | 'overdue' | 'today' | 'soon' | 'later'

/** Within this many days a deadline is "soon" (shown with the warning tone). */
const SOON_DAYS = 7
/**
 * Without a status, a deadline missed this recently is "en retard" and an
 * older one only "passée", so the days alone never alarm about last year's
 * deadlines. With the tracker (lib/declarations), a deadline nothing was
 * recorded for stays "En retard" (components/features/deadlines/deadline-status-badge.tsx).
 */
export const OVERDUE_DAYS = 15

export function urgencyOf(day: string, today: string): DeadlineUrgency {
  const days = daysUntil(day, today)
  if (days < -OVERDUE_DAYS) return 'past'
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  return days <= SOON_DAYS ? 'soon' : 'later'
}

export function relativeDeadlineLabel(day: string, today: string): string {
  const days = daysUntil(day, today)
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'demain'
  if (days > 1) return `dans ${days} jours`
  if (days < -OVERDUE_DAYS) return 'passée'
  return days === -1 ? 'en retard de 1 jour' : `en retard de ${-days} jours`
}
