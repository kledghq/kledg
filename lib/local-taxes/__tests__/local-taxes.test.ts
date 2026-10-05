/**
 * Local taxes (lib/local-taxes, docs/impots-locaux.md): worked examples of
 * each rule against its source, verified on 5 October 2026.
 * - CFE: CGI art. 1447, 1467, 1477 (1447-C-SD by 31 December of the year of
 *   creation, 1447-M-SD in May), 1478, II (no CFE the year of creation, base
 *   halved the year after), 1647 D (no cotisation minimum up to 5 000 € of
 *   turnover), 1679 quinquies (acompte of 50 % by 15 June when last year's
 *   CFE reached 3 000 €, balance by 15 December).
 * - CVAE: CGI art. 1586 ter to 1586 nonies; loi n° 2025-127 du 14 février
 *   2025, art. 62 (0,19 % in 2025 with a contribution complémentaire of
 *   47,4 %, 0,28 % in 2026 and 2027, 0,19 % in 2028, 0,09 % in 2029,
 *   abolished from 2030; the loi de finances pour 2026 kept this calendar);
 *   BOI-CVAE-LIQ-10 (rates by band, rounded to the hundredth, its example
 *   at 2 700 000 €: 0,08 %; dégrèvement of 188 € under 2 000 000 €; no CVAE
 *   of 63 € or less); art. 1586 sexies, VII (value added capped at 80 % or
 *   85 % of turnover); art. 1586 octies (1330-CVAE above 152 500 €); art.
 *   1679 septies (acomptes above 1 500 €).
 * - Plafonnement: CGI art. 1647 B sexies, BOI-IF-CFE-40-30-20-30 §190
 *   (1,531 % in 2026 and 2027, 1,438 % in 2025 and 2028, 1,344 % in 2029,
 *   1,25 % from 2030).
 */

import { describe, expect, it } from 'vitest'
import { cfeAcompteDue, computeDeadlines, type DeadlineCompany, type DeadlineInput } from '@/lib/deadlines/engine'
import { DEFAULT_DEADLINE_SETTINGS, type DeadlineSettings } from '@/lib/deadlines/settings'
import type { Deadline } from '@/lib/deadlines/types'
import { cfeAcompteOf, cfeMinimumExempt, cfeSchedule, cfeYearSituation, expectedCfeCharge } from '../cfe'
import {
  capValueAdded,
  computeCvae,
  cvaeAcomptes,
  cvaeMaxRateLabel,
  cvaeRateHundredths,
  cvaeYearStatus,
  plafonnementEstimate,
  plafonnementRate,
} from '../cvae'
import { annualize, cvaePeriodOf } from '../period'
import { valueAddedFromBooks } from '../value-added'
import { LOCAL_TAX_SOURCES } from '../sources'

const e = (euros: number) => Math.round(euros * 100)

const SAS: DeadlineCompany = { legalType: 'SAS', vatRegime: 'normal', isVatExempt: false, corporateTaxRegime: 'simplified', foundationDate: '2020-01-06', regimeHistory: [] }

function run(overrides: Partial<Omit<DeadlineInput, 'settings'>> & { settings?: Partial<DeadlineSettings> } = {}): Deadline[] {
  return computeDeadlines({
    company: overrides.company ?? SAS,
    fiscalYears: overrides.fiscalYears ?? [{ id: 'fy25', startDate: '2025-01-01', endDate: '2025-12-31' }, { id: 'fy26', startDate: '2026-01-01', endDate: '2026-12-31' }],
    settings: { ...DEFAULT_DEADLINE_SETTINGS, ...overrides.settings },
    cfeAmounts: overrides.cfeAmounts,
    from: overrides.from ?? '2026-01-01',
    to: overrides.to ?? '2026-12-31',
  })
}
const byId = (list: Deadline[], id: string) => list.find((d) => d.id === id)

describe('CFE acompte (CGI art. 1679 quinquies)', () => {
  it('asks 50 % of last year’s CFE when it reached 3 000 €, nothing below', () => {
    expect(cfeAcompteOf(e(3_000))).toBe(e(1_500))
    expect(cfeAcompteOf(e(4_321.15))).toBe(216_058) // 2 160,575 € rounded half up to the cent
    expect(cfeAcompteOf(e(2_999.99))).toBe(0)
  })

  it('lets the avis of the year before decide the 15 June deadline, whatever the setting', () => {
    const above = run({ cfeAmounts: { 2025: e(3_000) } })
    expect(byId(above, 'cfe-acompte:2026')).toMatchObject({ date: '2026-06-15' })
    expect(byId(above, 'cfe-acompte:2026')?.condition).toBeUndefined()
    expect(byId(above, 'cfe-acompte:2026')?.note).toMatch(/3\s000/)
    expect(byId(above, 'cfe:2026')?.label).toBe('Solde de la CFE 2026')
    const below = run({ cfeAmounts: { 2025: e(2_999) }, settings: { cfeAcompte: true } })
    expect(byId(below, 'cfe-acompte:2026')).toBeUndefined()
    expect(byId(below, 'cfe:2026')).toMatchObject({ label: 'Paiement de la CFE 2026', date: '2026-12-15' })
    // Unknown amount: the setting, shown with its condition
    expect(byId(run({ settings: { cfeAcompte: true } }), 'cfe-acompte:2026')?.condition).toMatch(/3\s000/)
    expect(cfeAcompteDue(2026, { cfeAcompte: false }, 2020, { 2025: e(5_000) })).toEqual({ due: true, known: true })
  })

  it('computes the schedule: acompte from the avis d’acompte, else 50 % of last year; balance once the avis is known', () => {
    expect(cfeSchedule({ totalCents: e(4_000), acompteCents: null }, { totalCents: e(3_500), acompteCents: null }, 'normal')).toEqual({
      acompteCents: e(1_750),
      acompteFrom: 'previous-year',
      balanceCents: e(2_250),
    })
    expect(cfeSchedule({ totalCents: e(4_000), acompteCents: e(1_600) }, null, 'normal')).toEqual({ acompteCents: e(1_600), acompteFrom: 'avis', balanceCents: e(2_400) })
    expect(cfeSchedule(null, { totalCents: e(800), acompteCents: null }, 'normal')).toEqual({ acompteCents: 0, acompteFrom: 'none', balanceCents: null })
    expect(cfeSchedule(null, null, 'normal').acompteFrom).toBe('unknown')
  })

  it('plans the charge on 63511, June and December, from the avis or last year’s CFE', () => {
    expect(expectedCfeCharge(2026, { totalCents: e(4_000), acompteCents: null }, { totalCents: e(3_500), acompteCents: null }, 'normal')).toMatchObject({
      cents: e(4_000),
      source: 'avis',
      account: { code: '63511' },
      months: [
        { month: '2026-06', cents: e(1_750) },
        { month: '2026-12', cents: e(2_250) },
      ],
    })
    expect(expectedCfeCharge(2026, null, { totalCents: e(1_200), acompteCents: null }, 'normal')).toMatchObject({ cents: e(1_200), source: 'previous-year', months: [{ month: '2026-12', cents: e(1_200) }] })
    expect(expectedCfeCharge(2026, null, null, 'creation-year')).toMatchObject({ cents: 0, source: 'creation-year', months: [] })
    expect(expectedCfeCharge(2026, null, null, 'normal')).toMatchObject({ cents: null, source: 'unknown' })
  })
})

describe('CFE of a new company (CGI art. 1477, II and 1478, II)', () => {
  const created = { ...SAS, foundationDate: '2026-03-01' }
  const years = [{ id: 'fy26', startDate: '2026-03-01', endDate: '2026-12-31' }]

  it('exempts the year of creation, files the 1447-C-SD by 31 December, halves the base the year after', () => {
    expect(cfeYearSituation(2026, 2026)).toBe('creation-year')
    expect(cfeYearSituation(2027, 2026)).toBe('half-base')
    expect(cfeYearSituation(2028, 2026)).toBe('normal')
    expect(cfeYearSituation(2028, null)).toBe('unknown')
    const deadlines = run({ company: created, fiscalYears: years, from: '2026-01-01', to: '2027-12-31', settings: { cfeAcompte: true } })
    expect(byId(deadlines, 'cfe:2026')).toBeUndefined()
    expect(byId(deadlines, 'cfe-1447c:2026')).toMatchObject({ date: '2026-12-31', form: '1447-C-SD', category: 'cfe' })
    // First CFE in 2027, without an acompte (no CFE in 2026)
    expect(byId(deadlines, 'cfe:2027')).toMatchObject({ date: '2027-12-15', label: 'Paiement de la CFE 2027' })
    expect(byId(deadlines, 'cfe-acompte:2027')).toBeUndefined()
    expect(cfeSchedule({ totalCents: e(900), acompteCents: null }, null, 'half-base')).toMatchObject({ acompteCents: 0, acompteFrom: 'none', balanceCents: e(900) })
  })

  it('files the 1447-M-SD in May when the company says something changed', () => {
    expect(byId(run(), 'cfe-1447m:2026')).toBeUndefined()
    expect(byId(run({ settings: { cfeChanges: true } }), 'cfe-1447m:2026')).toMatchObject({ date: '2026-05-05', form: '1447-M-SD', label: 'Déclaration des changements de CFE survenus en 2025' })
  })

  it('exempts from the cotisation minimum up to 5 000 € of turnover (CGI art. 1647 D)', () => {
    expect(cfeMinimumExempt(e(5_000))).toBe(true)
    expect(cfeMinimumExempt(e(5_000.01))).toBe(false)
    expect(cfeMinimumExempt(null)).toBeNull()
  })
})

describe('CVAE rate by year and turnover (CGI art. 1586 quater, BOI-CVAE-LIQ-10)', () => {
  it('follows the phase out of the loi n° 2025-127: 0,28 % in 2026, abolished from 2030', () => {
    expect(cvaeMaxRateLabel(2024)).toBe('0,28 %')
    expect(cvaeMaxRateLabel(2025)).toBe('0,19 %')
    expect(cvaeMaxRateLabel(2026)).toBe('0,28 %')
    expect(cvaeMaxRateLabel(2027)).toBe('0,28 %')
    expect(cvaeMaxRateLabel(2028)).toBe('0,19 %')
    expect(cvaeMaxRateLabel(2029)).toBe('0,09 %')
    expect(cvaeMaxRateLabel(2030)).toBeNull()
    expect(cvaeYearStatus(2026)).toBe('in-force')
    expect(cvaeYearStatus(2030)).toBe('abolished')
    expect(cvaeYearStatus(2041)).toBe('abolished')
    expect(cvaeYearStatus(2023)).toBe('not-covered')
  })

  it('rounds the effective rate to the hundredth, as the BOFiP example (2 700 000 €: 0,0827 % gives 0,08 %)', () => {
    expect(cvaeRateHundredths(2026, e(2_700_000))).toBe(8)
    expect(cvaeRateHundredths(2026, e(500_000))).toBe(0)
    expect(cvaeRateHundredths(2026, e(7_600_000))).toBe(21) // 0,094 + 0,169 x 4,6 / 7 = 0,2051 %
    expect(cvaeRateHundredths(2026, e(30_000_000))).toBe(27) // 0,263 + 0,019 x 20 / 40 = 0,2725 %
    expect(cvaeRateHundredths(2026, e(60_000_000))).toBe(28)
    expect(cvaeRateHundredths(2025, e(60_000_000))).toBe(19)
    expect(cvaeRateHundredths(2029, e(60_000_000))).toBe(9)
    expect(cvaeRateHundredths(2030, e(60_000_000))).toBe(0)
  })
})

describe('CVAE liability by turnover and year', () => {
  const cvae = (year: number, turnover: number, valueAdded: number) =>
    computeCvae({ year, turnoverCents: e(turnover), turnoverAnnualCents: e(turnover), valueAddedCents: e(valueAdded) })

  it('nothing up to 152 500 €, the 1330-CVAE alone up to 500 000 €, the CVAE above', () => {
    expect(cvae(2026, 152_500, 100_000)).toMatchObject({ declarationRequired: false, taxable: false, totalCents: 0 })
    expect(cvae(2026, 152_500.01, 100_000)).toMatchObject({ declarationRequired: true, taxable: false, totalCents: 0 })
    expect(cvae(2026, 500_000, 300_000)).toMatchObject({ declarationRequired: true, taxable: false, totalCents: 0 })
    expect(cvae(2026, 2_700_000, 1_000_000)).toMatchObject({ declarationRequired: true, taxable: true, rateLabel: '0,08 %', grossCents: e(800), degrevementCents: 0, cvaeCents: e(800), totalCents: e(800) })
  })

  it('caps the value added at 80 % of turnover and takes the dégrèvement of 188 € under 2 000 000 €', () => {
    // 1 800 000 €: 0,094 x 1,3 / 2,5 = 0,0489 %, rounded to 0,05 %; value added capped at 1 440 000 €
    const c = cvae(2026, 1_800_000, 1_500_000)
    expect(c.valueAdded).toEqual({ beforeCapCents: e(1_500_000), capCents: e(1_440_000), capped: true, cents: e(1_440_000) })
    expect(c).toMatchObject({ rateHundredths: 5, grossCents: e(720), degrevementCents: e(188), cvaeCents: e(532), franchise: false })
    expect(capValueAdded(e(9_000_000), e(10_000_000))).toEqual({ cents: e(8_500_000), capCents: e(8_500_000), capped: true })
    // The dégrèvement never makes the CVAE negative
    expect(cvae(2026, 1_200_000, 600_000)).toMatchObject({ grossCents: e(180), degrevementCents: e(180), cvaeCents: 0 })
  })

  it('drops a CVAE of 63 € or less after the dégrèvement (BOI-CVAE-LIQ-10 §180)', () => {
    // 2028: 0,063 x 0,8 / 2,5 = 0,0202 %, rounded to 0,02 %; 940 000 x 0,02 % = 188 €, minus 125 € = 63 €
    expect(cvae(2028, 1_300_000, 940_000)).toMatchObject({ grossCents: e(188), degrevementCents: e(125), franchise: true, cvaeCents: 0, totalCents: 0 })
    expect(cvae(2028, 1_300_000, 950_000)).toMatchObject({ grossCents: e(190), franchise: false, cvaeCents: e(65) })
  })

  it('adds the contribution complémentaire of 47,4 % in 2025, bringing it back to about 0,28 %', () => {
    expect(cvae(2025, 60_000_000, 10_000_000)).toMatchObject({ rateLabel: '0,19 %', cvaeCents: e(19_000), complementaryCents: e(9_006), totalCents: e(28_006) })
    expect(cvae(2026, 60_000_000, 10_000_000)).toMatchObject({ rateLabel: '0,28 %', cvaeCents: e(28_000), complementaryCents: 0 })
    expect(cvae(2029, 60_000_000, 10_000_000)).toMatchObject({ rateLabel: '0,09 %', cvaeCents: e(9_000) })
  })

  it('computes nothing for an abolished year or a year before 2024', () => {
    expect(cvae(2030, 60_000_000, 10_000_000)).toMatchObject({ status: 'abolished', declarationRequired: false, taxable: false, totalCents: 0 })
    expect(cvae(2023, 60_000_000, 10_000_000)).toMatchObject({ status: 'not-covered', totalCents: 0 })
  })

  it('asks two acomptes when last year’s CVAE exceeded 1 500 € (CGI art. 1679 septies)', () => {
    expect(cvaeAcomptes(2026, e(1_500), e(2_000))).toEqual({ due: false, eachCents: null })
    expect(cvaeAcomptes(2026, e(1_500.01), e(2_000.01))).toEqual({ due: true, eachCents: 100_001 })
    expect(cvaeAcomptes(2026, null, null)).toEqual({ due: null, eachCents: null })
    expect(cvaeAcomptes(2030, e(9_000), e(9_000))).toEqual({ due: false, eachCents: null })
  })
})

describe('CVAE deadlines stop with the abolition', () => {
  const settings = { cvae: true, cvaeDue: true, cvaeAcomptes: true }

  it('lists the 1330-CVAE and 1329-DEF in May and the 1329-AC in June and September', () => {
    const deadlines = run({ settings })
    expect(byId(deadlines, 'cvae:2025')).toMatchObject({ date: '2026-05-05', form: '1330-CVAE', category: 'cvae' })
    expect(byId(deadlines, 'cvae-solde:2025')).toMatchObject({ date: '2026-05-05', form: '1329-DEF', category: 'cvae' })
    expect(byId(deadlines, 'cvae-acompte:2026:1')).toMatchObject({ date: '2026-06-15', form: '1329-AC' })
    expect(byId(deadlines, 'cvae-acompte:2026:2')).toMatchObject({ date: '2026-09-15', label: '2e acompte de CVAE 2026' })
  })

  it('files the last 1330-CVAE and 1329-DEF, those of 2029, in 2030 and nothing after', () => {
    const deadlines = run({ settings, from: '2030-01-01', to: '2031-12-31', fiscalYears: [{ id: 'fy30', startDate: '2030-01-01', endDate: '2030-12-31' }] })
    expect(byId(deadlines, 'cvae:2029')).toMatchObject({ date: '2030-05-03' })
    expect(byId(deadlines, 'cvae:2029')?.note).toMatch(/supprimée à partir de 2030/)
    expect(byId(deadlines, 'cvae-solde:2029')).toBeDefined()
    expect(deadlines.filter((d) => d.category === 'cvae' && !d.id.includes(':2029'))).toEqual([])
  })
})

describe('value added from the books and period', () => {
  const account = (code: string, debit: number, credit: number) => ({ accountId: code, code, label: code, debitCents: e(debit), creditCents: e(credit) })

  it('starts from the SIG value added, adds 74, 75 and 791, deducts 65; personnel and taxes stay in', () => {
    const books = valueAddedFromBooks([
      account('706000', 0, 1_000_000),
      account('707000', 0, 300_000),
      account('607000', 200_000, 0),
      account('6064', 50_000, 0),
      account('613200', 100_000, 0),
      account('740000', 0, 10_000),
      account('758000', 0, 5_000),
      account('791000', 0, 2_000),
      account('651000', 3_000, 0),
      account('641000', 400_000, 0),
      account('635110', 20_000, 0),
    ])
    expect(books).toEqual({
      turnoverCents: e(1_300_000),
      sigValueAddedCents: e(950_000),
      subsidiesCents: e(10_000),
      otherProductsCents: e(5_000),
      chargeTransfersCents: e(2_000),
      otherChargesCents: e(3_000),
      valueAddedCents: e(964_000),
    })
  })

  it('takes the fiscal years closed in the year, annualizes the turnover of a short one', () => {
    const fys = [
      { id: 'a', year: 2026, startDate: '2025-07-01', endDate: '2026-06-30', isClosed: true },
      { id: 'b', year: 2027, startDate: '2026-07-01', endDate: '2027-06-30', isClosed: false },
    ]
    expect(cvaePeriodOf(2026, fys, '2026-10-05')).toMatchObject({ months: 12, estimate: false, fiscalYears: [{ id: 'a' }] })
    expect(cvaePeriodOf(2027, fys, '2026-10-05')).toMatchObject({ months: 12, estimate: true })
    expect(cvaePeriodOf(2028, fys, '2026-10-05')).toBeNull()
    expect(annualize(e(300_000), { months: 6, days: 181 })).toBe(e(600_000))
    expect(annualize(e(300_000), { months: 12, days: 365 })).toBe(e(300_000))
  })
})

describe('plafonnement of the CET (CGI art. 1647 B sexies)', () => {
  it('uses the rate of the year and gives back the CET above it, at most the CFE', () => {
    expect([2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031].map(plafonnementRate)).toEqual([1531, 1438, 1531, 1531, 1438, 1344, 1250, 1250])
    expect(plafonnementRate(2023)).toBeNull()
    // Value added 1 000 000 € in 2026: ceiling 15 310 €; CFE 20 000 € + CVAE 800 € = 20 800 €
    expect(plafonnementEstimate(2026, e(20_000), e(800), e(1_000_000))).toEqual({ rate: 1531, ceilingCents: e(15_310), excessCents: e(5_490) })
    expect(plafonnementEstimate(2026, e(1_000), e(800), e(1_000_000))?.excessCents).toBe(0)
    expect(plafonnementEstimate(2026, e(3_000), e(30_000), e(100_000))?.excessCents).toBe(e(3_000))
    expect(plafonnementEstimate(2026, null, 0, e(1_000_000))).toBeNull()
  })
})

describe('sources', () => {
  it('cites official texts only, in French without dashes', () => {
    for (const source of Object.values(LOCAL_TAX_SOURCES)) {
      expect(source.url).toMatch(/^https:\/\/(www\.legifrance\.gouv\.fr|bofip\.impots\.gouv\.fr|www\.impots\.gouv\.fr)\//)
      expect(source.label).not.toMatch(/[–—]| :/)
    }
  })
})
