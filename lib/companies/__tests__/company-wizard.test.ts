/**
 * Company creation wizard: validation shared by the form and the API, and
 * the first fiscal year rules (Code de commerce art. L123-12: twelve months;
 * first exercice up to 24 months by common practice; CGI art. 209, I: first
 * tax period ends at the latest on 31 December of the year after creation).
 */

import { describe, expect, it } from 'vitest'
import {
  CreateCompanySchema,
  checkFirstFiscalYear,
  periodEnd,
  periodMonths,
  shareCapitalCents,
  sharePercentage,
  suggestFirstFiscalYear,
  type CreateCompanyInput,
} from '../company-wizard'

const valid: CreateCompanyInput = {
  name: 'Atelier Lumen',
  siren: '912 345 675',
  legalType: 'SASU',
  foundationDate: '2026-03-14',
  firstFiscalYear: { startDate: '2026-03-14', endDate: '2026-12-31', isFirst: true },
  vatRegime: 'simplified',
  corporateTaxRegime: 'simplified',
  totalShares: 1000,
  shareNominalValueCents: 100,
  shareholders: [{ type: 'PHYSICAL', firstName: 'Claire', name: 'Martin', numberOfShares: 1000 }],
}

const issues = (input: CreateCompanyInput) => {
  const parsed = CreateCompanySchema.safeParse(input)
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message)
}

describe('period arithmetic', () => {
  it('ends a period the day before the same date months later', () => {
    expect(periodEnd('2026-01-01', 12)).toBe('2026-12-31')
    expect(periodEnd('2026-03-14', 24)).toBe('2028-03-13')
    // No 31 February: the anniversary is 1 March, the period ends on 28 February
    expect(periodEnd('2026-01-31', 1)).toBe('2026-02-28')
    expect(periodEnd('2026-01-28', 1)).toBe('2026-02-27')
    // KLEDG-R3-QUAL-22: a first year starting on 29 February 2024
    expect(periodEnd('2024-02-29', 12)).toBe('2025-02-28')
    expect(periodEnd('2024-02-29', 48)).toBe('2028-02-28')
    expect(periodEnd('2023-12-01', 3)).toBe('2024-02-29')
    expect(periodMonths('2026-01-01', '2026-12-31')).toBe(12)
    expect(periodMonths('2026-03-14', '2026-12-31')).toBe(10)
    expect(periodMonths('2026-01-01', '2027-01-31')).toBe(13)
  })
})

describe('checkFirstFiscalYear', () => {
  const first = { isFirst: true, subjectToCorporateTax: true }

  it('accepts a first exercice up to 24 months and refuses beyond (common practice)', () => {
    expect(checkFirstFiscalYear({ ...first, startDate: '2026-03-14', endDate: '2028-03-13' }).errors).toEqual([])
    const tooLong = checkFirstFiscalYear({ ...first, startDate: '2026-03-14', endDate: '2028-03-31' })
    expect(tooLong.errors[0]).toMatch(/24 mois/)
    expect(tooLong.errors[0]).toMatch(/13\/03\/2028/)
  })

  it('warns an IS company whose first exercice closes after 31 December of the next year (CGI art. 209, I)', () => {
    const late = checkFirstFiscalYear({ ...first, startDate: '2026-03-14', endDate: '2028-02-29' })
    expect(late.errors).toEqual([])
    expect(late.warnings.join(' ')).toMatch(/31\/12\/2027.*CGI art\. 209/)
    const ir = checkFirstFiscalYear({ ...first, subjectToCorporateTax: false, startDate: '2026-03-14', endDate: '2028-02-29' })
    expect(ir.warnings).toEqual([])
  })

  it('allows a short first exercice with a note (no minimum duration)', () => {
    const short = checkFirstFiscalYear({ ...first, startDate: '2026-10-01', endDate: '2026-12-31' })
    expect(short.errors).toEqual([])
    expect(short.months).toBe(3)
    expect(short.warnings[0]).toMatch(/Premier exercice court \(3 mois\)/)
  })

  it('refuses an end before the start and a start before the creation date', () => {
    expect(checkFirstFiscalYear({ ...first, startDate: '2026-12-31', endDate: '2026-01-01' }).errors[0]).toMatch(/après sa date de début/)
    expect(
      checkFirstFiscalYear({ ...first, startDate: '2026-01-01', endDate: '2026-12-31', foundationDate: '2026-03-14' }).errors[0],
    ).toMatch(/avant la date de création/)
  })

  it('expects 12 months for the exercice of an existing company (Code de commerce art. L123-12)', () => {
    const existing = { isFirst: false, subjectToCorporateTax: true }
    expect(checkFirstFiscalYear({ ...existing, startDate: '2026-01-01', endDate: '2026-12-31' }).warnings).toEqual([])
    expect(checkFirstFiscalYear({ ...existing, startDate: '2026-01-01', endDate: '2027-03-31' }).warnings[0]).toMatch(/L123-12/)
  })
})

describe('CreateCompanySchema', () => {
  it('accepts a complete wizard and normalizes the SIREN', () => {
    const parsed = CreateCompanySchema.parse(valid)
    expect(parsed.siren).toBe('912345675')
    expect(parsed.includeOptionalAccounts).toBe(false)
  })

  it('requires a name and a 9 digit SIREN', () => {
    expect(issues({ ...valid, name: ' ' })).toContain('Indiquez le nom de la société.')
    expect(issues({ ...valid, siren: '12345' })).toContain('Le SIREN compte exactement 9 chiffres.')
  })

  it('refuses an unknown legal form and an invalid head office SIRET', () => {
    expect(issues({ ...valid, legalType: 'HOLDING' as never }).length).toBeGreaterThan(0)
    expect(issues({ ...valid, headOffice: { siret: '123' } })).toContain('Le SIRET compte exactement 14 chiffres.')
    expect(issues({ ...valid, headOffice: { siret: '' } })).toEqual([])
  })

  it('refuses a first exercice longer than 24 months', () => {
    expect(
      issues({ ...valid, firstFiscalYear: { startDate: '2026-03-14', endDate: '2028-12-31', isFirst: true } }).join(' '),
    ).toMatch(/24 mois/)
  })

  it('only accepts the VAT and IS regimes offered', () => {
    expect(issues({ ...valid, vatRegime: 'mini_real' as never }).length).toBeGreaterThan(0)
    expect(issues({ ...valid, corporateTaxRegime: null })).toEqual([])
  })

  it('checks shareholders against the number of shares', () => {
    expect(issues({ ...valid, totalShares: null })).toContain('Indiquez le nombre total de parts pour répartir le capital.')
    expect(
      issues({
        ...valid,
        shareholders: [
          { type: 'PHYSICAL', firstName: 'Claire', name: 'Martin', numberOfShares: 800 },
          { type: 'LEGAL', name: 'Lumen Holding', numberOfShares: 300 },
        ],
      }).join(' '),
    ).toMatch(/1100 parts, plus que les 1000/)
    expect(issues({ ...valid, shareholders: [{ type: 'PHYSICAL', name: 'Martin', numberOfShares: 10 }] })).toContain(
      "Indiquez le prénom de l'associé.",
    )
  })
})

describe('capital helpers', () => {
  it('computes the share capital in cents and the percentage held', () => {
    expect(shareCapitalCents(1000, 100)).toBe(100_000)
    expect(shareCapitalCents(null, 100)).toBeNull()
    expect(sharePercentage(1, 3)).toBe(33.33)
    expect(sharePercentage(1000, 1000)).toBe(100)
  })
})

describe('suggestFirstFiscalYear', () => {
  it('closes a new company on 31 December, the next year when created in the last quarter', () => {
    expect(suggestFirstFiscalYear({ today: '2026-10-03', foundationDate: '2026-03-14' })).toEqual({
      startDate: '2026-03-14',
      endDate: '2026-12-31',
      isFirst: true,
    })
    expect(suggestFirstFiscalYear({ today: '2026-11-20', foundationDate: '2026-11-02' })).toEqual({
      startDate: '2026-11-02',
      endDate: '2027-12-31',
      isFirst: true,
    })
  })

  it('starts the exercice in progress for an existing company', () => {
    expect(suggestFirstFiscalYear({ today: '2026-10-03', foundationDate: '2015-01-01' })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      isFirst: false,
    })
    expect(suggestFirstFiscalYear({ today: '2026-10-03', closingMonth: 6, closingDay: 30 })).toEqual({
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      isFirst: false,
    })
  })
})
