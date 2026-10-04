import { describe, expect, it } from 'vitest'
import { dayWindow, matchProbableDuplicates, signedCents, type ExistingLine } from '@/lib/banking/probable-duplicates'

const line = (amountCents: number, day: string, valueDay: string | null = null) => ({ amountCents, day, valueDay })
const existing = (id: string, amountCents: number, day: string, valueDay: string | null = null): ExistingLine => ({ id, amountCents, day, valueDay })

describe('matchProbableDuplicates', () => {
  it('matches the same signed amount on the same booking day', () => {
    const matches = matchProbableDuplicates([line(-350, '2026-09-01'), line(-350, '2026-09-02')], [existing('a', -350, '2026-09-01')])
    expect([...matches].map(([i, e]) => [i, e.id])).toEqual([[0, 'a']])
  })

  it('never matches the other side or another amount', () => {
    expect(matchProbableDuplicates([line(350, '2026-09-01')], [existing('a', -350, '2026-09-01')]).size).toBe(0)
    expect(matchProbableDuplicates([line(-351, '2026-09-01')], [existing('a', -350, '2026-09-01')]).size).toBe(0)
  })

  it('is count aware: three identical new lines against two existing ones match two', () => {
    const incoming = [line(-350, '2026-09-01'), line(-350, '2026-09-01'), line(-350, '2026-09-01')]
    const matches = matchProbableDuplicates(incoming, [existing('a', -350, '2026-09-01'), existing('b', -350, '2026-09-01')])
    expect([...matches].map(([i, e]) => [i, e.id])).toEqual([
      [0, 'a'],
      [1, 'b'],
    ])
  })

  it('falls back to the value day when both sides have one, never to a wider window', () => {
    const byValue = matchProbableDuplicates([line(-12_000, '2026-09-01', '2026-09-03')], [existing('a', -12_000, '2026-09-02', '2026-09-03')])
    expect(byValue.get(0)?.id).toBe('a')
    expect(matchProbableDuplicates([line(-12_000, '2026-09-01')], [existing('a', -12_000, '2026-09-02', '2026-09-03')]).size).toBe(0)
    expect(matchProbableDuplicates([line(-12_000, '2026-09-01', '2026-09-03')], [existing('a', -12_000, '2026-09-02')]).size).toBe(0)
  })

  it('prefers a booking day match over a value day match for the same line', () => {
    const matches = matchProbableDuplicates(
      [line(-500, '2026-09-02', '2026-09-01')],
      [existing('by-value', -500, '2026-08-31', '2026-09-01'), existing('by-day', -500, '2026-09-02')],
    )
    expect(matches.get(0)?.id).toBe('by-day')
  })
})

describe('signedCents and dayWindow', () => {
  it('signs stored lines by their side', () => {
    expect(signedCents(1234, 'debit')).toBe(-1234)
    expect(signedCents(1234, 'Débit')).toBe(-1234)
    expect(signedCents(1234, 'credit')).toBe(1234)
  })

  it('spans booking and value days', () => {
    expect(dayWindow([line(1, '2026-09-05', '2026-09-01'), line(1, '2026-09-03')])).toEqual({ first: '2026-09-01', last: '2026-09-05' })
    expect(dayWindow([])).toBeNull()
  })
})
