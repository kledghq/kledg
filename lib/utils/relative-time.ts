/**
 * "il y a 5 minutes", "hier", "il y a 3 jours": how long ago an instant was
 * (last bank sync, last import), in French. Pure: shared by server and
 * client code. Beyond a week, the date itself reads better than a count of
 * days, so it falls back to "le 03/10/2026".
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

export function formatRelativeTime(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const elapsed = now.getTime() - date.getTime()
  // A clock slightly ahead on the server must not read "dans 2 minutes".
  if (elapsed < MINUTE) return "à l'instant"
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day')
  return `le ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
}
