import { describe, expect, it } from 'vitest'
import { newTransactions, normalizeIban, refreshRetryAfter, supersededAccounts } from '@/lib/banking/sync-rules'
import { consentStatus, earliestExpiry } from '@/lib/banking/consent'

describe('dedupe on the provider transaction id', () => {
  it('skips ids already stored and repeats inside the batch', () => {
    const incoming = [{ externalId: 'a' }, { externalId: 'b' }, { externalId: 'b' }, { externalId: 'c' }]
    expect(newTransactions(incoming, ['a']).map((t) => t.externalId)).toEqual(['b', 'c'])
  })

  it('keeps Revolut legs of one transaction apart (transaction id + leg id)', () => {
    const incoming = [{ externalId: 'tx1:leg1' }, { externalId: 'tx1:leg2' }]
    expect(newTransactions(incoming, [])).toHaveLength(2)
    expect(newTransactions(incoming, ['tx1:leg1']).map((t) => t.externalId)).toEqual(['tx1:leg2'])
  })

  it('creates nothing when the same sync runs twice', () => {
    const incoming = [{ externalId: 'x' }, { externalId: 'y' }]
    const first = newTransactions(incoming, [])
    expect(newTransactions(incoming, first.map((t) => t.externalId))).toEqual([])
  })
})

describe('direct connection preferred over Ponto for the same IBAN', () => {
  it('supersedes the Ponto account covered by Qonto direct', () => {
    const result = supersededAccounts([
      { id: 'qonto-1', iban: 'FR76 1695 8000 0165 4321 0987 654', kind: 'direct' },
      { id: 'ponto-1', iban: 'fr7616958000016543210987654', kind: 'aggregator' },
      { id: 'ponto-2', iban: 'FR7630004000031234567890143', kind: 'aggregator' },
    ])
    expect([...result]).toEqual([['ponto-1', 'qonto-1']])
  })

  it('also prefers Revolut direct', () => {
    const result = supersededAccounts([
      { id: 'ponto-r', iban: 'LT123250000000000001', kind: 'aggregator' },
      { id: 'revolut-1', iban: 'LT123250000000000001', kind: 'direct' },
    ])
    expect(result.get('ponto-r')).toBe('revolut-1')
  })

  it('never touches manual accounts or accounts without IBAN', () => {
    const result = supersededAccounts([
      { id: 'manual', iban: 'FR7630004000031234567890143', kind: 'manual' },
      { id: 'ponto', iban: 'FR7630004000031234567890143', kind: 'aggregator' },
      { id: 'ponto-no-iban', iban: null, kind: 'aggregator' },
      { id: 'direct-no-iban', iban: null, kind: 'direct' },
    ])
    expect(result.size).toBe(0)
  })

  it('normalizes IBANs', () => {
    expect(normalizeIban(' fr76 3000 4000 ')).toBe('FR7630004000')
    expect(normalizeIban('  ')).toBeNull()
  })
})

describe('Ponto manual refresh throttle (5 minutes)', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  it('allows the first refresh', () => {
    expect(refreshRetryAfter(null, now)).toBe(0)
  })
  it('asks to wait until 5 minutes have passed', () => {
    expect(refreshRetryAfter(new Date('2026-10-03T11:58:00Z'), now)).toBe(180)
    expect(refreshRetryAfter(new Date('2026-10-03T11:59:59.500Z'), now)).toBe(300)
  })
  it('allows again after 5 minutes', () => {
    expect(refreshRetryAfter(new Date('2026-10-03T11:55:00Z'), now)).toBe(0)
  })
})

describe('consent expiry', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000)

  it('is ok beyond 14 days, then warns at D-14 and D-3', () => {
    expect(consentStatus(inDays(30), now)).toMatchObject({ level: 'ok', daysLeft: 30 })
    expect(consentStatus(inDays(14), now)).toMatchObject({ level: 'soon', daysLeft: 14 })
    expect(consentStatus(inDays(4), now).level).toBe('soon')
    expect(consentStatus(inDays(3), now)).toMatchObject({ level: 'urgent', daysLeft: 3 })
    expect(consentStatus(new Date(now.getTime() + 60_000), now)).toMatchObject({ level: 'urgent', daysLeft: 1 })
  })

  it('reports stale since the expiry date once passed', () => {
    const expiry = inDays(-2)
    const status = consentStatus(expiry, now)
    expect(status.level).toBe('expired')
    expect(status.staleSince?.toISOString()).toBe(expiry.toISOString())
    expect(consentStatus(now, now).level).toBe('expired')
  })

  it('has no level without a date, and accepts ISO strings', () => {
    expect(consentStatus(null, now).level).toBe('none')
    expect(consentStatus('not a date', now).level).toBe('none')
    expect(consentStatus(inDays(10).toISOString(), now).level).toBe('soon')
  })

  it('keeps the earliest expiry of a connection', () => {
    expect(earliestExpiry([inDays(20), null, inDays(5), inDays(9)])?.toISOString()).toBe(inDays(5).toISOString())
    expect(earliestExpiry([null, undefined])).toBeNull()
  })
})
