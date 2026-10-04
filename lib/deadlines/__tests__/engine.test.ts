/**
 * Deadline engine (lib/deadlines/engine.ts). Each rule is checked against its
 * source, verified on 4 October 2026:
 * - TVA: CGI art. 287 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048826856),
 *   CGI ann. IV art. 39 and BOI-TVA-DECLA-20-20-10-10 §200 and §220 (CA3 day
 *   grid, postponement to the next working day,
 *   https://bofip.impots.gouv.fr/bofip/1001-PGP.html/identifiant=BOI-TVA-DECLA-20-20-10-10-20230118),
 *   BOI-TVA-DECLA-20-20-30-10 (réel simplifié), suppression of the réel
 *   simplifié on 1 January 2027 (loi n° 2025-127, art. 38;
 *   https://www.impots.gouv.fr/actualite/le-regime-simplifie-dimposition-la-tva-est-supprime-compter-du-1er-janvier-2027),
 *   franchise: BOI-TVA-DECLA-40-10-10 (no return).
 * - IS: CGI art. 1668 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033836779),
 *   BOI-IS-DECLA-20-10 §60 to 100 and §360 (order of the acomptes by
 *   closing date, short exercices, 3 000 € threshold; https://bofip.impots.gouv.fr/bofip/3558-PGP.html).
 * - Liasse: CGI art. 223 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000034387974)
 *   and the impots.gouv.fr calendar of May and June 2026
 *   (https://www.impots.gouv.fr/professionnel/calendrier-fiscal/2026-05).
 * - CFE: CGI art. 1679 quinquies (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033812199),
 *   art. 1478, II (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051202382).
 * - Comptes annuels: Code de commerce L223-26, L225-100, L227-9 (approval
 *   within six months), L232-22 and L232-23 (filing within one month, two
 *   when filed online).
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  addMonthsEom,
  computeDeadlines,
  isAcompteDates,
  missingVatRegime,
  secondBusinessDayAfterMayFirst,
  type DeadlineCompany,
  type DeadlineFiscalYear,
  type DeadlineInput,
} from '../engine'
import { RULES } from '../rules'
import { DEFAULT_DEADLINE_SETTINGS, type DeadlineSettings } from '../settings'
import type { Deadline } from '../types'

const SAS: DeadlineCompany = {
  legalType: 'SAS',
  vatRegime: 'normal',
  isVatExempt: false,
  corporateTaxRegime: 'simplified',
  foundationDate: '2020-01-06',
  regimeHistory: [],
}

const fy = (startDate: string, endDate: string): DeadlineFiscalYear => ({ id: `fy-${endDate}`, startDate, endDate })
const CALENDAR_YEARS = [fy('2025-01-01', '2025-12-31'), fy('2026-01-01', '2026-12-31')]

function run(overrides: Partial<Omit<DeadlineInput, 'settings'>> & { settings?: Partial<DeadlineSettings> } = {}): Deadline[] {
  return computeDeadlines({
    company: overrides.company ?? SAS,
    fiscalYears: overrides.fiscalYears ?? CALENDAR_YEARS,
    settings: { ...DEFAULT_DEADLINE_SETTINGS, ...overrides.settings },
    from: overrides.from ?? '2026-01-01',
    to: overrides.to ?? '2026-12-31',
  })
}

const ofRule = (deadlines: Deadline[], ruleId: string) => deadlines.filter((d) => d.ruleId === ruleId)
const dates = (deadlines: Deadline[], ruleId: string) => ofRule(deadlines, ruleId).map((d) => d.date)
const byId = (deadlines: Deadline[], id: string) => deadlines.find((d) => d.id === id)

describe('date helpers', () => {
  it('reads "dans les N mois" of a month-end closing as the end of the target month', () => {
    expect(addMonthsEom('2025-12-31', 6)).toBe('2026-06-30')
    expect(addMonthsEom('2026-06-30', 1)).toBe('2026-07-31')
    expect(addMonthsEom('2026-02-28', 3)).toBe('2026-05-31')
    expect(addMonthsEom('2027-02-28', 12)).toBe('2028-02-29')
    expect(addMonthsEom('2026-03-31', 3)).toBe('2026-06-30')
    expect(addMonthsEom('2026-01-15', 1)).toBe('2026-02-15')
    expect(addMonthsEom('2026-01-30', 1)).toBe('2026-02-28')
  })

  it('finds the second business day after 1 May (CGI art. 223: 5 May 2026, 4 May 2027)', () => {
    expect(secondBusinessDayAfterMayFirst(2026)).toBe('2026-05-05')
    expect(secondBusinessDayAfterMayFirst(2027)).toBe('2027-05-04')
  })
})

describe('TVA, réel normal (CA3)', () => {
  it('lists one CA3 a month, on the earliest day of a company (the 19th), postponed past weekends', () => {
    const ca3 = ofRule(run(), 'tva-ca3')
    expect(ca3.map((d) => d.label)[0]).toBe('Déclaration et paiement de la TVA de décembre 2025')
    expect(ca3).toHaveLength(12)
    // March 2026: 19 April 2026 is a Sunday.
    const march = byId(ca3, 'tva-ca3:2026-03')
    expect(march).toMatchObject({ legalDate: '2026-04-19', date: '2026-04-20', estimated: true, form: 'CA3', category: 'tva' })
    expect(march?.note).toBeUndefined()
  })

  it('takes the earliest day of the legal form when the day is not set: 15 (EI or unknown), 23 (SA)', () => {
    expect(byId(run({ company: { ...SAS, legalType: 'SA' } }), 'tva-ca3:2026-04')?.legalDate).toBe('2026-05-23')
    expect(byId(run({ company: { ...SAS, legalType: null } }), 'tva-ca3:2026-04')?.legalDate).toBe('2026-05-15')
  })

  it('uses the day set by the company, no longer indicative', () => {
    const april = byId(run({ settings: { vatFilingDay: 21 } }), 'tva-ca3:2026-04')
    expect(april).toMatchObject({ legalDate: '2026-05-21', date: '2026-05-21', estimated: false })
  })

  it('postpones a CA3 day falling on a public holiday (BOI-TVA-DECLA-20-20-10-10 §220): 15 August 2026, a Saturday', () => {
    expect(byId(run({ settings: { vatFilingDay: 15 } }), 'tva-ca3:2026-07')).toMatchObject({ legalDate: '2026-08-15', date: '2026-08-17' })
  })

  it('lists quarterly CA3 on option (annual VAT under 4 000 €, CGI art. 287, 2)', () => {
    const ca3 = ofRule(run({ settings: { vatCa3Frequency: 'quarterly' } }), 'tva-ca3')
    expect(ca3.map((d) => d.id)).toEqual(['tva-ca3:2025-T4', 'tva-ca3:2026-T1', 'tva-ca3:2026-T2', 'tva-ca3:2026-T3'])
    expect(ca3[1]).toMatchObject({ legalDate: '2026-04-19', date: '2026-04-20', label: 'Déclaration et paiement de la TVA du 1er trimestre 2026' })
    expect(ca3[1].condition).toMatch(/4 000/)
  })

  it('treats the mini-réel and the former "real" value as réel normal for VAT', () => {
    expect(ofRule(run({ company: { ...SAS, vatRegime: 'mini_real' } }), 'tva-ca3')).toHaveLength(12)
    expect(ofRule(run({ company: { ...SAS, vatRegime: 'real' } }), 'tva-ca3')).toHaveLength(12)
  })
})

describe('TVA, franchise and exemptions', () => {
  it('lists no VAT return in franchise en base (BOI-TVA-DECLA-40-10-10)', () => {
    const deadlines = run({ company: { ...SAS, vatRegime: 'franchise' } })
    expect(deadlines.filter((d) => d.category === 'tva')).toEqual([])
    expect(deadlines.length).toBeGreaterThan(0)
  })

  it('lists no VAT return for a company exempt of VAT', () => {
    expect(run({ company: { ...SAS, isVatExempt: true } }).filter((d) => d.category === 'tva')).toEqual([])
  })

  it('says when the VAT regime is unknown, and lists the rest', () => {
    const company = { ...SAS, vatRegime: null }
    expect(missingVatRegime(company)).toBe(true)
    expect(missingVatRegime(SAS)).toBe(false)
    expect(missingVatRegime({ ...company, regimeHistory: [{ regimeType: 'vat', regime: 'normal', startDate: '2020-01-01', endDate: null }] })).toBe(false)
    const deadlines = run({ company })
    expect(deadlines.filter((d) => d.category === 'tva')).toEqual([])
    expect(ofRule(deadlines, 'is-solde')).toHaveLength(1)
  })
})

describe('TVA, réel simplifié (CA12 and acomptes)', () => {
  const simplified = { ...SAS, vatRegime: 'simplified' }

  it('lists the July and December acomptes on the CA3 day, postponed past weekends', () => {
    const acomptes = ofRule(run({ company: simplified }), 'tva-acompte')
    expect(acomptes.map((d) => [d.legalDate, d.date])).toEqual([
      ['2026-07-19', '2026-07-20'], // Sunday
      ['2026-12-19', '2026-12-21'], // Saturday
    ])
    expect(acomptes[0].label).toBe('Acompte de TVA de juillet 2026 (55 % de la TVA de 2025)')
    expect(acomptes[1].label).toBe('Acompte de TVA de décembre 2026 (40 % de la TVA de 2025)')
    expect(acomptes[0].condition).toMatch(/1 000/)
  })

  it('files the CA12 of a calendar year the second business day after 1 May', () => {
    expect(byId(run({ company: simplified }), 'tva-ca12:2025')).toMatchObject({ date: '2026-05-05', form: 'CA12', label: 'Déclaration annuelle de TVA 2025' })
  })

  it('stops with 2026: last CA12 on 4 May 2027, no acompte in 2027, quarterly CA3 from 2027', () => {
    const deadlines = run({ company: simplified, from: '2027-01-01', to: '2027-12-31', fiscalYears: [...CALENDAR_YEARS, fy('2027-01-01', '2027-12-31')] })
    expect(byId(deadlines, 'tva-ca12:2026')).toMatchObject({ date: '2027-05-04' })
    expect(byId(deadlines, 'tva-ca12:2026')?.note).toMatch(/Dernière CA12/)
    expect(ofRule(deadlines, 'tva-acompte')).toEqual([])
    expect(ofRule(deadlines, 'tva-ca3').map((d) => d.id)).toEqual(['tva-ca3:2027-T1', 'tva-ca3:2027-T2', 'tva-ca3:2027-T3'])
    expect(ofRule(deadlines, 'tva-ca3')[0].note).toMatch(/supprimé au 1er janvier 2027/)
    // Monthly on request.
    const monthly = run({ company: simplified, from: '2027-01-01', to: '2027-12-31', settings: { vatCa3Frequency: 'monthly' } })
    expect(ofRule(monthly, 'tva-ca3')).toHaveLength(11)
  })

  it('drops the acomptes when the company says last year VAT was under 1 000 €', () => {
    expect(ofRule(run({ company: simplified, settings: { vatSimplifiedAcomptes: false } }), 'tva-acompte')).toEqual([])
  })

  it('follows the regime history over the company field', () => {
    const company: DeadlineCompany = {
      ...SAS,
      vatRegime: 'normal',
      regimeHistory: [
        { regimeType: 'vat', regime: 'simplified', startDate: '2020-01-01', endDate: '2026-05-31' },
        { regimeType: 'vat', regime: 'normal', startDate: '2026-06-01', endDate: null },
        // An exemption of one establishment does not change the returns of the company.
        { regimeType: 'vat', regime: 'franchise', startDate: '2026-01-01', endDate: null, establishmentId: 'est-1' },
      ],
    }
    const deadlines = run({ company })
    expect(ofRule(deadlines, 'tva-ca3').map((d) => d.id)[0]).toBe('tva-ca3:2026-06')
    expect(byId(deadlines, 'tva-ca12:2025')).toBeDefined()
    expect(ofRule(deadlines, 'tva-acompte')).toEqual([])
  })
})

describe('IS acomptes (CGI art. 1668, 1; BOI-IS-DECLA-20-10)', () => {
  it('pays four acomptes for a calendar exercice: 15 March (16 in 2026, a Sunday), 15 June, 15 September, 15 December', () => {
    const acomptes = ofRule(run(), 'is-acompte')
    expect(acomptes.map((d) => d.date)).toEqual(['2026-03-16', '2026-06-15', '2026-09-15', '2026-12-15'])
    expect(acomptes[0]).toMatchObject({ legalDate: '2026-03-15', form: '2571', label: "1er acompte d'IS de l'exercice clos le 31/12/2026" })
    expect(acomptes[0].condition).toMatch(/3 000/)
  })

  it('orders the acomptes by closing date, as the BOFiP table does', () => {
    // 20/11 to 19/02: 15/03, 15/06, 15/09, 15/12
    expect(isAcompteDates(fy('2025-02-01', '2026-01-31'))).toEqual(['2025-03-15', '2025-06-15', '2025-09-15', '2025-12-15'])
    expect(isAcompteDates(fy('2024-12-01', '2025-11-30'))).toEqual(['2025-03-15', '2025-06-15', '2025-09-15', '2025-12-15'])
    // 20/02 to 19/05: 15/06, 15/09, 15/12, 15/03
    expect(isAcompteDates(fy('2025-04-01', '2026-03-31'))).toEqual(['2025-06-15', '2025-09-15', '2025-12-15', '2026-03-15'])
    expect(isAcompteDates(fy('2025-03-01', '2026-02-28'))).toEqual(['2025-06-15', '2025-09-15', '2025-12-15', '2026-03-15'])
    // 20/05 to 19/08: 15/09, 15/12, 15/03, 15/06
    expect(isAcompteDates(fy('2025-07-01', '2026-06-30'))).toEqual(['2025-09-15', '2025-12-15', '2026-03-15', '2026-06-15'])
    // 20/08 to 19/11: 15/12, 15/03, 15/06, 15/09
    expect(isAcompteDates(fy('2025-10-01', '2026-09-30'))).toEqual(['2025-12-15', '2026-03-15', '2026-06-15', '2026-09-15'])
  })

  it('pays as many acomptes as a short exercice holds quarterly dates (BOFiP: 1 March to 30 November, three)', () => {
    expect(isAcompteDates(fy('2026-03-01', '2026-11-30'))).toEqual(['2026-06-15', '2026-09-15', '2026-12-15'])
  })

  it('pays no acompte during the first exercice of a new company', () => {
    const company = { ...SAS, foundationDate: '2026-01-10' }
    const deadlines = run({ company, fiscalYears: [fy('2026-01-10', '2026-12-31')] })
    expect(ofRule(deadlines, 'is-acompte')).toEqual([])
    // The next one (extrapolated here) has its four acomptes.
    const next = run({ company, fiscalYears: [fy('2026-01-10', '2026-12-31')], from: '2027-01-01', to: '2027-12-31' })
    expect(dates(next, 'is-acompte')).toEqual(['2027-03-15', '2027-06-15', '2027-09-15', '2027-12-15'])
    expect(ofRule(next, 'is-acompte').every((d) => d.projected)).toBe(true)
  })

  it('keeps the acomptes when the earliest exercice in Kledg is not the first of the company', () => {
    expect(ofRule(run({ fiscalYears: [fy('2026-01-01', '2026-12-31')] }), 'is-acompte')).toHaveLength(4)
  })

  it('drops the acomptes when the IS of reference is 3 000 € or less', () => {
    expect(ofRule(run({ settings: { isAcomptes: false } }), 'is-acompte')).toEqual([])
  })
})

describe('IS solde (2572) and liasse (2065)', () => {
  it('31 December closing: solde on 15 May, liasse the second business day after 1 May, 15 more days online', () => {
    const deadlines = run()
    expect(byId(deadlines, 'is-solde:2025-12-31')).toMatchObject({ date: '2026-05-15', form: '2572', category: 'is' })
    expect(byId(deadlines, 'liasse:2025-12-31')).toMatchObject({
      date: '2026-05-05',
      extendedDate: '2026-05-20',
      form: '2065 et 2033',
      category: 'liasse',
      label: "Déclaration de résultat et liasse fiscale de l'exercice clos le 31/12/2025",
    })
    expect(byId(run({ company: { ...SAS, corporateTaxRegime: 'normal' } }), 'liasse:2025-12-31')?.form).toBe('2065 et 2050')
  })

  it('other closings: solde the 15th of the fourth month, liasse within three months (2026 calendar)', () => {
    const years = [fy('2025-04-01', '2026-03-31'), fy('2025-07-01', '2026-06-30'), fy('2025-08-01', '2026-07-31'), fy('2025-09-01', '2026-08-31')]
    const deadlines = (closing: string) => run({ fiscalYears: [years.find((y) => y.endDate === closing) as DeadlineFiscalYear], to: '2027-06-30' })
    expect(byId(deadlines('2026-03-31'), 'liasse:2026-03-31')).toMatchObject({ date: '2026-06-30', extendedDate: '2026-07-15' })
    expect(byId(deadlines('2026-03-31'), 'is-solde:2026-03-31')?.date).toBe('2026-07-15')
    expect(byId(deadlines('2026-06-30'), 'liasse:2026-06-30')?.date).toBe('2026-09-30')
    expect(byId(deadlines('2026-06-30'), 'is-solde:2026-06-30')?.date).toBe('2026-10-15')
    // 15 November 2026 is a Sunday: 16 November in the calendar.
    expect(byId(deadlines('2026-07-31'), 'is-solde:2026-07-31')).toMatchObject({ legalDate: '2026-11-15', date: '2026-11-16' })
    expect(byId(deadlines('2026-08-31'), 'liasse:2026-08-31')?.date).toBe('2026-11-30')
  })

  it('February closings: solde 15 June, liasse 31 May brought back to Friday 29 May 2026 as the calendar shows', () => {
    const deadlines = run({ fiscalYears: [fy('2025-03-01', '2026-02-28')] })
    expect(byId(deadlines, 'is-solde:2026-02-28')?.date).toBe('2026-06-15')
    expect(byId(deadlines, 'liasse:2026-02-28')).toMatchObject({ legalDate: '2026-05-31', date: '2026-05-29' })
    // Leap year: 29 February 2028, liasse on 31 May 2028 (a Wednesday).
    const leap = run({ fiscalYears: [fy('2027-03-01', '2028-02-29')], from: '2028-01-01', to: '2028-12-31' })
    expect(byId(leap, 'liasse:2028-02-29')?.date).toBe('2028-05-31')
    expect(byId(leap, 'approbation:2028-02-29')?.date).toBe('2028-08-31')
  })

  it('lists nothing for IS when the company is not subject to it (impôt sur le revenu, micro)', () => {
    for (const corporateTaxRegime of [null, 'micro']) {
      const deadlines = run({ company: { ...SAS, corporateTaxRegime } })
      expect(deadlines.filter((d) => d.category === 'is' || d.ruleId === 'liasse')).toEqual([])
    }
  })
})

describe('DAS2 and CVAE (on demand)', () => {
  it('files the DAS2 with the results return when the company says it pays fees', () => {
    expect(ofRule(run(), 'das2')).toEqual([])
    const das2 = byId(run({ settings: { das2: true } }), 'das2:2025')
    expect(das2).toMatchObject({ date: '2026-05-05', form: 'DAS2', label: 'Déclaration des honoraires versés en 2025' })
    expect(das2?.condition).toMatch(/2 400/)
    // Non-calendar exercice: with the liasse, for the previous calendar year.
    expect(byId(run({ fiscalYears: [fy('2025-07-01', '2026-06-30')], settings: { das2: true } }), 'das2:2025')?.date).toBe('2026-09-30')
  })

  it('files the 1330-CVAE the second business day after 1 May, 15 more days online', () => {
    expect(ofRule(run(), 'cvae')).toEqual([])
    expect(byId(run({ settings: { cvae: true } }), 'cvae:2025')).toMatchObject({ date: '2026-05-05', extendedDate: '2026-05-20', form: '1330-CVAE' })
  })
})

describe('CFE (CGI art. 1679 quinquies, art. 1478)', () => {
  it('pays the CFE on 15 December, postponed past weekends', () => {
    expect(byId(run(), 'cfe:2026')).toMatchObject({ date: '2026-12-15', label: 'Paiement de la CFE 2026', category: 'cfe' })
    expect(byId(run({ from: '2024-01-01', to: '2024-12-31' }), 'cfe:2024')).toMatchObject({ legalDate: '2024-12-15', date: '2024-12-16' })
  })

  it('adds the 15 June acompte when the company says last year CFE reached 3 000 €', () => {
    expect(ofRule(run(), 'cfe-acompte')).toEqual([])
    const deadlines = run({ settings: { cfeAcompte: true } })
    expect(byId(deadlines, 'cfe-acompte:2026')?.date).toBe('2026-06-15')
    expect(byId(deadlines, 'cfe:2026')?.label).toBe('Solde de la CFE 2026')
  })

  it('is not due the year of creation, and has no acompte the year after', () => {
    const company = { ...SAS, foundationDate: '2026-03-02' }
    expect(ofRule(run({ company, settings: { cfeAcompte: true } }), 'cfe')).toEqual([])
    const next = run({ company, settings: { cfeAcompte: true }, from: '2027-01-01', to: '2028-12-31' })
    expect(dates(next, 'cfe')).toEqual(['2027-12-15', '2028-12-15'])
    expect(dates(next, 'cfe-acompte')).toEqual(['2028-06-15'])
  })
})

describe('comptes annuels (Code de commerce)', () => {
  it('approval within six months, filing one month after (two online), never postponed', () => {
    const deadlines = run({ from: '2026-01-01', to: '2027-12-31' })
    // 30 August 2026 is a Sunday: legal deadlines are kept as written.
    expect(byId(deadlines, 'approbation:2025-12-31')).toMatchObject({ date: '2026-06-30', category: 'juridique' })
    expect(byId(deadlines, 'depot-comptes:2025-12-31')?.date).toBe('2026-07-31')
    expect(byId(run({ settings: { accountsFiledOnline: true } }), 'depot-comptes:2025-12-31')?.date).toBe('2026-08-31')
    expect(byId(run({ fiscalYears: [fy('2025-03-01', '2026-02-28')] }), 'depot-comptes:2026-02-28')).toMatchObject({ legalDate: '2026-09-30', date: '2026-09-30' })
  })

  it('notes the SAS statutes and the SASU shortcut', () => {
    expect(byId(run(), 'approbation:2025-12-31')?.note).toMatch(/statuts/)
    expect(byId(run({ company: { ...SAS, legalType: 'SASU' } }), 'approbation:2025-12-31')?.note).toMatch(/vaut approbation/)
    expect(byId(run({ company: { ...SAS, legalType: 'SARL' } }), 'approbation:2025-12-31')?.note).toBeUndefined()
  })

  it('lists no approval or filing for forms without that obligation (EI, SCI, SNC)', () => {
    for (const legalType of ['EI', 'SCI', 'SNC']) {
      expect(run({ company: { ...SAS, legalType } }).filter((d) => d.category === 'juridique'), legalType).toEqual([])
    }
    expect(run({ company: { ...SAS, legalType: null } }).filter((d) => d.category === 'juridique')).toHaveLength(2)
  })
})

describe('range and projection', () => {
  it('keeps only deadlines dated within the range, both days included, in date order', () => {
    const deadlines = run({ from: '2026-05-05', to: '2026-05-15' })
    expect(deadlines.map((d) => d.id)).toEqual(['liasse:2025-12-31', 'is-solde:2025-12-31'])
    expect(run({ from: '2026-05-06', to: '2026-05-14' })).toEqual([])
    const all = run({ from: '2025-01-01', to: '2027-12-31' })
    expect(all.map((d) => d.date)).toEqual([...all.map((d) => d.date)].sort())
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length)
  })

  it('extrapolates twelve-month exercices after the last one, flagged as projected', () => {
    const deadlines = run({ fiscalYears: [fy('2025-01-01', '2025-12-31')] })
    expect(byId(deadlines, 'is-solde:2025-12-31')?.projected).toBe(false)
    expect(ofRule(deadlines, 'is-acompte')).toHaveLength(4)
    expect(ofRule(deadlines, 'is-acompte').every((d) => d.projected)).toBe(true)
  })

  it('lists only calendar based deadlines without any fiscal year', () => {
    const deadlines = run({ fiscalYears: [] })
    expect(new Set(deadlines.map((d) => d.ruleId))).toEqual(new Set(['tva-ca3', 'cfe']))
  })

  it('cites a source for every rule, with French text without dashes', () => {
    for (const rule of Object.values(RULES)) {
      expect(rule.sources.length, rule.id).toBeGreaterThan(0)
      for (const source of rule.sources) expect(source.url, rule.id).toMatch(/^https:\/\/(www\.legifrance\.gouv\.fr|bofip\.impots\.gouv\.fr|www\.impots\.gouv\.fr)\//)
      expect(rule.summary, rule.id).not.toMatch(/[–—]/)
      expect(rule.summary, rule.id).not.toMatch(/ :/)
    }
    for (const d of run({ from: '2025-01-01', to: '2027-12-31', settings: { das2: true, cvae: true, cfeAcompte: true } })) {
      expect(`${d.label} ${d.condition ?? ''} ${d.note ?? ''}`, d.id).not.toMatch(/[–—]| :/)
    }
  })
})

describe.each(['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'])('with TZ=%s', (zone) => {
  const original = process.env.TZ
  afterAll(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  it('gives the same days whatever the server timezone', () => {
    process.env.TZ = zone
    const deadlines = run()
    expect(byId(deadlines, 'liasse:2025-12-31')?.date).toBe('2026-05-05')
    expect(byId(deadlines, 'is-acompte:2026-12-31:1')?.date).toBe('2026-03-16')
    expect(byId(deadlines, 'tva-ca3:2026-03')?.date).toBe('2026-04-20')
  })
})
