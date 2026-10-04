/**
 * Recognising a company of the group in the books (match.ts) and the
 * periods and percentages of the group view (periods.ts). Fictitious
 * companies.
 */

import { describe, expect, it } from 'vitest'
import { companyBySiren, companyNamedIn, normalizeName } from '../match'
import { participationKindOf, percentToBp, pickFiscalYear, samePeriod, shareOfCents } from '../periods'

const NORD = { id: 'n', name: 'Filiale Nord SAS', siren: '931000020' }
const NORD_SERVICES = { id: 'ns', name: 'Nord Services', siren: '931000038' }
const ETE = { id: 'e', name: 'Été & Cie', siren: null }
const GROUP = [NORD, NORD_SERVICES, ETE]

describe('normalizeName', () => {
  it('drops accents, punctuation and legal forms', () => {
    expect(normalizeName('Société Été & Cie SARL')).toBe('ete cie')
    expect(normalizeName('FILIALE NORD, S.A.S.')).toBe('filiale nord')
  })
})

describe('companyNamedIn', () => {
  it('finds the company an account label names, whole words only', () => {
    expect(companyNamedIn(GROUP, '455100 Compte courant Filiale Nord')).toBe(NORD)
    expect(companyNamedIn(GROUP, 'Titres ete et cie')).toBeNull()
    expect(companyNamedIn(GROUP, 'Titres Été & Cie')).toBe(ETE)
    expect(companyNamedIn(GROUP, 'Filiale Nordique')).toBeNull()
  })

  it('prefers the longest name and reads every text given', () => {
    expect(companyNamedIn([{ id: 'x', name: 'Nord', siren: null }, NORD_SERVICES], 'Avance Nord Services')).toBe(NORD_SERVICES)
    expect(companyNamedIn(GROUP, 'Produits de participations', null, 'Dividendes Nord Services 2025')).toBe(NORD_SERVICES)
  })

  it('finds a SIREN written in the label', () => {
    expect(companyNamedIn(GROUP, 'Titres 931 000 020')).toBe(NORD)
  })

  it('never matches a name shorter than three characters', () => {
    expect(companyNamedIn([{ id: 'x', name: 'AB SAS', siren: null }], 'Compte courant AB')).toBeNull()
  })
})

describe('companyBySiren', () => {
  it('matches the SIREN of a tiers, spaces ignored', () => {
    expect(companyBySiren(GROUP, '931 000 038')).toBe(NORD_SERVICES)
    expect(companyBySiren(GROUP, null)).toBeNull()
    expect(companyBySiren(GROUP, '123456789')).toBeNull()
  })
})

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const year = (id: string, start: string, end: string) => ({ id, startDate: day(start), endDate: day(end) })

describe('pickFiscalYear', () => {
  const start = day('2026-01-01')
  const end = day('2026-12-31')

  it('takes the fiscal year that ends the same day', () => {
    expect(pickFiscalYear([year('a', '2025-01-01', '2025-12-31'), year('b', '2026-01-01', '2026-12-31')], start, end)?.id).toBe('b')
  })

  it('otherwise the one that overlaps the period the most', () => {
    const years = [year('a', '2025-07-01', '2026-06-30'), year('b', '2026-07-01', '2027-06-30')]
    // 181 days of 2026 in a, 184 in b.
    expect(pickFiscalYear(years, start, end)?.id).toBe('b')
    expect(samePeriod(years[1], start, end)).toBe(false)
  })

  it('returns null without an overlapping fiscal year', () => {
    expect(pickFiscalYear([year('a', '2024-01-01', '2024-12-31')], start, end)).toBeNull()
  })
})

describe('percentages', () => {
  it('reads a recorded percentage in basis points', () => {
    expect(percentToBp('60.00')).toBe(6000)
    expect(percentToBp('33.3')).toBe(3330)
    expect(percentToBp('100')).toBe(10000)
    expect(percentToBp('abc')).toBe(0)
  })

  it('takes a share of an amount, rounded half up to the cent', () => {
    expect(shareOfCents(15_000_000, 6000)).toBe(9_000_000)
    expect(shareOfCents(101, 5000)).toBe(51)
    expect(shareOfCents(-101, 5000)).toBe(-51)
  })

  it('classifies a holding as filiale above 50 % (C. com. L233-1), participation from 10 % (L233-2)', () => {
    expect(participationKindOf(5001)).toBe('filiale')
    expect(participationKindOf(5000)).toBe('participation')
    expect(participationKindOf(1000)).toBe('participation')
    expect(participationKindOf(999)).toBe('autre')
  })
})
