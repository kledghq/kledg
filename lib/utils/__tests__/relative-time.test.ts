import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../relative-time'

const now = new Date('2026-10-03T14:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)

describe('formatRelativeTime', () => {
  it('reads in French, from seconds to days', () => {
    expect(formatRelativeTime(ago(20_000), now)).toBe("à l'instant")
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('il y a 5 minutes')
    expect(formatRelativeTime(ago(2 * 3_600_000), now)).toBe('il y a 2 heures')
    expect(formatRelativeTime(ago(26 * 3_600_000), now)).toBe('hier')
    expect(formatRelativeTime(ago(3 * 86_400_000), now)).toBe('il y a 3 jours')
  })

  it('shows the date beyond a week', () => {
    expect(formatRelativeTime(ago(30 * 86_400_000), now)).toMatch(/^le \d{2}\/\d{2}\/2026$/)
  })

  it('treats an instant in the future as now and ignores missing values', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 60_000), now)).toBe("à l'instant")
    expect(formatRelativeTime(null, now)).toBe('')
    expect(formatRelativeTime('not a date', now)).toBe('')
  })
})
