/**
 * Worked examples of the impôt sur les sociétés worksheet, on plain values
 * (lib/corporate-tax). Sources: CGI art. 219, I (25 %, 15 % up to 42 500 €
 * per twelve months, chiffre d'affaires of 10 M€ at most ramené à douze
 * mois, capital libéré and 75 % natural persons; BOI-IS-LIQ-20-10), art.
 * 209, I (deficits: 1 000 000 € plus 50 % of the excess; BOI-IS-DEF-10-30),
 * art. 235 ter ZC (3,3 % above 763 000 €), art. 213 and 39, 2 (IS, vehicle
 * taxes, fines), art. 145 and 216 (parent-subsidiary regime, 5 %
 * quote-part), art. 1668 and BOI-IS-DECLA-20-10 (acomptes, 3 000 €
 * exemption, regularisation of the first acompte), BOI-IS-DECLA-20-30 (new
 * companies). Fictitious figures.
 */

import { describe, expect, it } from 'vitest'
import { balanceOf, quarterOf, referenceTax, scheduleAcomptes, type AcompteDue, type AcompteReference } from '../acomptes'
import { bookAdjustments, manualAdjustments, parentSubsidiaryAdjustments } from '../adjustments'
import { corporateTaxChecks, isReliable, type CheckInput } from '../checks'
import { computeCorporateTax, type Adjustment, type ComputeInput } from '../compute'
import { corporateTaxDeadlineTarget, corporateTaxPageOf } from '../deadline-links'
import { annualize, deficitCap, durationOf, mulDivRound, prorate, roundToEuro, taxAtRates } from '../rules'

const YEAR = durationOf('2026-01-01', '2026-12-31')
const k = (euros: number) => Math.round(euros * 100)

function input(over: Partial<ComputeInput> = {}): ComputeInput {
  return {
    regime: 'simplified',
    duration: YEAR,
    accountingResultCents: k(60_000),
    adjustments: [],
    credits: [],
    deficitsOpeningCents: 0,
    turnoverCents: k(500_000),
    capitalPaidUp: true,
    naturalPersons75: true,
    ...over,
  }
}

describe('durations and prorata (CGI art. 219, I: "par période de douze mois")', () => {
  it('counts whole months, else days', () => {
    expect(durationOf('2026-01-01', '2026-12-31')).toEqual({ months: 12, days: 365 })
    expect(durationOf('2026-01-01', '2026-06-30')).toEqual({ months: 6, days: 181 })
    expect(durationOf('2025-07-01', '2026-12-31')).toEqual({ months: 18, days: 549 })
    expect(durationOf('2028-01-01', '2028-12-31')).toEqual({ months: 12, days: 366 })
    expect(durationOf('2026-01-15', '2026-12-31')).toEqual({ months: null, days: 351 })
  })

  it('prorates the 42 500 € ceiling and annualizes the chiffre d’affaires', () => {
    expect(prorate(k(42_500), durationOf('2026-01-01', '2026-06-30'))).toBe(k(21_250))
    expect(prorate(k(42_500), durationOf('2025-07-01', '2026-12-31'))).toBe(k(63_750))
    // 351 days: 42 500 x 351 / 365 = 40 869,86 €
    expect(prorate(k(42_500), durationOf('2026-01-15', '2026-12-31'))).toBe(4_086_986)
    expect(annualize(k(6_000_000), durationOf('2026-01-01', '2026-06-30'))).toBe(k(12_000_000))
  })

  it('rounds exactly, half away from zero, to the cent and to the euro', () => {
    expect(mulDivRound(5, 1, 2)).toBe(3)
    expect(mulDivRound(-5, 1, 2)).toBe(-3)
    expect(mulDivRound(99_999_999_999_999, 12, 7)).toBe(171_428_571_428_570)
    expect(roundToEuro(123_450)).toBe(123_500)
    expect(roundToEuro(123_449)).toBe(123_400)
    expect(roundToEuro(-150)).toBe(-200)
  })
})

describe('IS at 15 % and 25 % (CGI art. 219, I)', () => {
  it('eligible company, twelve months: 15 % up to 42 500 €, 25 % above', () => {
    const c = computeCorporateTax(input())
    expect(c.taxableProfitCents).toBe(k(60_000))
    expect(c.reducedRate).toEqual({ applied: true, ceilingCents: k(42_500), baseCents: k(42_500), taxCents: k(6_375) })
    expect(c.normalRate).toEqual({ baseCents: k(17_500), taxCents: k(4_375) })
    expect(c.corporateTaxCents).toBe(k(10_750))
    expect(c.socialContribution).toMatchObject({ exempt: true, cents: 0 })
    expect(c.totalCents).toBe(k(10_750))
    expect(c.ifEligibleCents).toBeNull()
  })

  it('not eligible: chiffre d’affaires above 10 M€, or capital not paid up', () => {
    const big = computeCorporateTax(input({ turnoverCents: k(10_000_001) }))
    expect(big.eligibility).toMatchObject({ eligible: false, turnoverOk: false })
    expect(big.corporateTaxCents).toBe(k(15_000))
    // 10 000 000 € exactly is eligible ("n'excédant pas")
    expect(computeCorporateTax(input({ turnoverCents: k(10_000_000) })).eligibility.eligible).toBe(true)
    const unpaid = computeCorporateTax(input({ capitalPaidUp: false }))
    expect(unpaid.reducedRate.applied).toBe(false)
    expect(unpaid.corporateTaxCents).toBe(k(15_000))
  })

  it('an unanswered question computes at 25 % and says what the reduced rate would give', () => {
    const c = computeCorporateTax(input({ naturalPersons75: null }))
    expect(c.eligibility.eligible).toBeNull()
    expect(c.corporateTaxCents).toBe(k(15_000))
    expect(c.ifEligibleCents).toBe(k(10_750))
  })

  it('short fiscal year of six months: the ceiling is 21 250 € and the chiffre d’affaires is annualized', () => {
    const half = durationOf('2026-01-01', '2026-06-30')
    const c = computeCorporateTax(input({ duration: half, accountingResultCents: k(30_000), turnoverCents: k(400_000) }))
    expect(c.reducedRate).toMatchObject({ ceilingCents: k(21_250), baseCents: k(21_250), taxCents: 318_750 })
    expect(c.normalRate).toEqual({ baseCents: k(8_750), taxCents: 218_750 })
    expect(c.corporateTaxCents).toBe(k(5_375))
    // 6 M€ in six months is 12 M€ a year: no reduced rate
    const fast = computeCorporateTax(input({ duration: half, accountingResultCents: k(30_000), turnoverCents: k(6_000_000) }))
    expect(fast.eligibility).toMatchObject({ turnoverAnnualCents: k(12_000_000), eligible: false })
    expect(fast.corporateTaxCents).toBe(k(7_500))
  })

  it('long fiscal year of eighteen months: the ceiling is 63 750 €', () => {
    const c = computeCorporateTax(input({ duration: durationOf('2025-07-01', '2026-12-31'), accountingResultCents: k(100_000) }))
    expect(c.reducedRate).toMatchObject({ ceilingCents: k(63_750), taxCents: 956_250 })
    expect(c.normalRate.taxCents).toBe(906_250)
    expect(c.corporateTaxCents).toBe(1_862_500)
  })

  it('rounds the tax result to the euro as the forms are filled', () => {
    const c = computeCorporateTax(input({ accountingResultCents: 123_450 }))
    expect(c.resultBeforeDeficitsCents).toBe(123_500)
    expect(c.lines.find((l) => l.id === 'taxable')).toMatchObject({ formLine: '370', euros: 1_235 })
  })
})

describe('deficits carried forward (CGI art. 209, I)', () => {
  it('caps the imputation at 1 000 000 € plus 50 % of the profit above', () => {
    expect(deficitCap(k(800_000))).toBe(k(800_000))
    expect(deficitCap(k(3_000_000))).toBe(k(2_000_000))
    const c = computeCorporateTax(input({ accountingResultCents: k(3_000_000), deficitsOpeningCents: k(2_500_000), turnoverCents: k(20_000_000) }))
    expect(c.deficits).toEqual({ known: true, openingCents: k(2_500_000), capCents: k(2_000_000), imputedCents: k(2_000_000), createdCents: 0, closingCents: k(500_000) })
    expect(c.taxableProfitCents).toBe(k(1_000_000))
    expect(c.corporateTaxCents).toBe(k(250_000))
  })

  it('absorbs a small profit entirely and carries the rest', () => {
    const c = computeCorporateTax(input({ accountingResultCents: k(50_000), deficitsOpeningCents: k(80_000) }))
    expect(c.deficits).toMatchObject({ imputedCents: k(50_000), closingCents: k(30_000) })
    expect(c.taxableProfitCents).toBe(0)
    expect(c.corporateTaxCents).toBe(0)
    expect(c.lines.find((l) => l.id === 'deficits')).toMatchObject({ formLine: '360', amountCents: k(50_000) })
  })

  it('adds a loss to the deficits and declares it on 372 (2033-B) or XO (2058-A)', () => {
    const c = computeCorporateTax(input({ accountingResultCents: k(-40_000), deficitsOpeningCents: k(10_000) }))
    expect(c.deficits).toMatchObject({ imputedCents: 0, createdCents: k(40_000), closingCents: k(50_000) })
    expect(c.lines[0]).toMatchObject({ label: 'Perte comptable de l’exercice', formLine: '314' })
    expect(c.lines.find((l) => l.id === 'taxable')).toMatchObject({ formLine: '372', amountCents: k(-40_000) })
    const normal = computeCorporateTax(input({ regime: 'normal', accountingResultCents: k(-40_000) }))
    expect(normal.lines[0].formLine).toBe('WS')
    expect(normal.lines.find((l) => l.id === 'taxable')?.formLine).toBe('XO')
  })

  it('counts unknown deficits as none and says so', () => {
    const c = computeCorporateTax(input({ deficitsOpeningCents: null }))
    expect(c.deficits.known).toBe(false)
    expect(c.taxableProfitCents).toBe(k(60_000))
  })
})

describe('contribution sociale (CGI art. 235 ter ZC)', () => {
  it('3,3 % of the IS above 763 000 €, unless the company is exempt', () => {
    const big = computeCorporateTax(input({ accountingResultCents: k(5_000_000), turnoverCents: k(20_000_000) }))
    expect(big.corporateTaxCents).toBe(k(1_250_000))
    expect(big.socialContribution).toEqual({ exempt: false, allowanceCents: k(763_000), baseCents: k(487_000), cents: k(16_071) })
    expect(big.totalCents).toBe(k(1_266_071))
    // Under 7 630 000 € of chiffre d'affaires with the capital conditions: exempt
    const exempt = computeCorporateTax(input({ accountingResultCents: k(5_000_000), turnoverCents: k(7_000_000) }))
    expect(exempt.socialContribution).toMatchObject({ exempt: true, cents: 0 })
    // Below the allowance: nothing to pay even when not exempt
    expect(computeCorporateTax(input({ turnoverCents: k(20_000_000) })).socialContribution.cents).toBe(0)
  })

  it('prorates the allowance for a short year', () => {
    const c = computeCorporateTax(input({ duration: durationOf('2026-01-01', '2026-06-30'), accountingResultCents: k(4_000_000), turnoverCents: k(20_000_000) }))
    expect(c.socialContribution.allowanceCents).toBe(k(381_500))
    expect(c.socialContribution.baseCents).toBe(k(1_000_000 - 381_500))
  })
})

describe('reintegrations and deductions read from the accounts', () => {
  const acc = (code: string, debit: number, credit: number) => ({ accountId: code, code, label: code, debitCents: k(debit), creditCents: k(credit) })

  it('reintegrates the IS (art. 213), vehicle taxes (art. 213) and fines (art. 39, 2), never contractual penalties', () => {
    const lines = bookAdjustments([acc('6951', 5_000, 0), acc('6954', 300, 0), acc('63514', 700, 0), acc('6582', 400, 0), acc('6712', 100, 0), acc('6581', 900, 0), acc('6257', 1_200, 0)])
    expect(lines.map((l) => [l.id, l.kind, l.amountCents, l.form.simplified, l.form.normal])).toEqual([
      ['books-income-tax', 'reintegration', k(5_000), '324', 'I7'],
      ['books-vehicle-tax', 'reintegration', k(700), '324', 'WG'],
      ['books-penalties', 'reintegration', k(500), '330', 'WJ'],
    ])
  })

  it('deducts an IS reversed and the carry-back credit (art. 220 quinquies)', () => {
    const lines = bookAdjustments([acc('695', 0, 800), acc('699', 0, 2_000)])
    expect(lines.map((l) => [l.id, l.kind, l.amountCents])).toEqual([
      ['books-income-tax', 'deduction', k(800)],
      ['books-carry-back', 'deduction', k(2_000)],
    ])
  })

  it('deducts dividends of subsidiaries held 5 % or more and reintegrates 5 % (art. 145 and 216)', () => {
    const { adjustments, qualifying } = parentSubsidiaryAdjustments([
      { subsidiaryId: 's1', name: 'Filiale Nord', stakeBp: 6_000, dividendsCents: k(100_000) },
      { subsidiaryId: 's2', name: 'Participation Sud', stakeBp: 300, dividendsCents: k(10_000) },
    ])
    expect(qualifying.map((q) => q.subsidiaryId)).toEqual(['s1'])
    expect(adjustments.map((a) => [a.kind, a.amountCents])).toEqual([
      ['deduction', k(100_000)],
      ['reintegration', k(5_000)],
    ])
    const c = computeCorporateTax(input({ accountingResultCents: k(160_000), adjustments }))
    expect(c.resultBeforeDeficitsCents).toBe(k(65_000))
    expect(parentSubsidiaryAdjustments([{ subsidiaryId: 's', name: 'S', stakeBp: 499, dividendsCents: k(1) }]).adjustments).toEqual([])
  })

  it('keeps manual credits apart from the IS and reduces what is paid', () => {
    const { adjustments, credits } = manualAdjustments([
      { id: 'a', kind: 'reintegration', label: 'Dépenses de chasse', amountCents: k(2_000) },
      { id: 'b', kind: 'credit', label: 'Crédit d’impôt mécénat', amountCents: k(1_000) },
    ])
    const c = computeCorporateTax(input({ adjustments, credits }))
    expect(c.taxableProfitCents).toBe(k(62_000))
    expect(c.corporateTaxCents).toBe(k(11_250))
    expect(c.creditsCents).toBe(k(1_000))
    expect(c.totalCents).toBe(k(10_250))
    const line = c.lines.find((l) => l.id === 'manual-a')
    expect(line).toMatchObject({ kind: 'reintegration', origin: 'manual', formLine: '330' })
  })

  it('lists the lines in the order of the form', () => {
    const adj: Adjustment = { id: 'x', kind: 'deduction', origin: 'books', label: 'D', amountCents: 100, form: { simplified: '350', normal: 'XG' }, source: null, hint: '' }
    const c = computeCorporateTax(input({ adjustments: [adj, ...bookAdjustments([{ accountId: '695', code: '695', label: '', debitCents: 500, creditCents: 0 }])] }))
    expect(c.lines.map((l) => l.kind)).toEqual(['result', 'reintegration', 'deduction', 'subtotal', 'deficits', 'total'])
  })
})

describe('acomptes of the next year (CGI art. 1668, BOI-IS-DECLA-20-10)', () => {
  const dues: AcompteDue[] = [
    { number: 1, date: '2027-03-15', legalDate: '2027-03-15', deadlineId: 'is-acompte:2027-12-31:1' },
    { number: 2, date: '2027-06-15', legalDate: '2027-06-15', deadlineId: 'is-acompte:2027-12-31:2' },
    { number: 3, date: '2027-09-15', legalDate: '2027-09-15', deadlineId: 'is-acompte:2027-12-31:3' },
    { number: 4, date: '2027-12-15', legalDate: '2027-12-15', deadlineId: 'is-acompte:2027-12-31:4' },
  ]
  const ref = (profitEuros: number, over: Partial<AcompteReference> = {}): AcompteReference => ({ label: 'exercice 2026', profitCents: k(profitEuros), duration: YEAR, reducedRate: true, filed: false, ...over })

  it('quarters the reference IS, rounded to the euro', () => {
    expect(referenceTax(ref(60_000))).toBe(k(10_750))
    expect(quarterOf(k(10_750))).toBe(k(2_688))
    // The reference profit is brought to twelve months (§ 60)
    expect(referenceTax(ref(30_000, { duration: durationOf('2026-01-01', '2026-06-30') }))).toBe(k(10_750))
  })

  it('computes the first acompte on the year before and regularises it with the second', () => {
    const s = scheduleAcomptes({ dues, current: ref(60_000), previous: ref(53_333, { label: 'exercice 2025' }), firstOnPrevious: true })
    // 2025: 42 500 x 15 % + 10 833 x 25 % = 9 083,25 €, a quarter 2 271 €
    expect(s.items.map((i) => [i.number, i.amountCents, i.reference])).toEqual([
      [1, k(2_271), 'previous'],
      [2, k(2 * 2_688 - 2_271), 'current'],
      [3, k(2_688), 'current'],
      [4, k(2_688), 'current'],
    ])
    expect(s.totalCents).toBe(k(10_752))
    expect(s.exempt).toBe(false)
  })

  it('pays no acompte when the reference IS is 3 000 € or less', () => {
    // 20 000 € at 15 %: 3 000 €
    const s = scheduleAcomptes({ dues, current: ref(20_000), previous: ref(20_000), firstOnPrevious: true })
    expect(s.exempt).toBe(true)
    expect(s.items.every((i) => i.amountCents === 0 && i.exempt)).toBe(true)
    // 20 004 €: 3 000,60 € of IS, acomptes due
    expect(scheduleAcomptes({ dues, current: ref(20_004), previous: null, firstOnPrevious: false }).items[0].amountCents).toBe(k(750))
  })

  it('judges the exemption at each due date: a small previous year, a large current one', () => {
    const s = scheduleAcomptes({ dues, current: ref(60_000), previous: ref(10_000), firstOnPrevious: true })
    expect(s.items.map((i) => i.amountCents)).toEqual([0, k(5_376), k(2_688), k(2_688)])
    expect(s.items[0].exempt).toBe(true)
  })

  it('imputes a first acompte larger than half the new IS on the following ones', () => {
    const s = scheduleAcomptes({ dues, current: ref(26_667), previous: ref(240_000), firstOnPrevious: true })
    // previous: 6 375 + 197 500 x 25 % = 55 750 €, quarter 13 938 €; current 4 000,05 € → quarter 1 000 €
    expect(s.items.map((i) => i.amountCents)).toEqual([k(13_938), 0, 0, 0])
  })

  it('new company: nothing on the first date, the second brings half of the IS (BOI-IS-DECLA-20-30)', () => {
    const s = scheduleAcomptes({ dues, current: ref(60_000), previous: 'none', firstOnPrevious: true })
    expect(s.items.map((i) => [i.amountCents, i.reference])).toEqual([
      [0, 'none'],
      [k(5_376), 'current'],
      [k(2_688), 'current'],
      [k(2_688), 'current'],
    ])
  })

  it('leaves the first two to compute when the previous return is not recorded', () => {
    const s = scheduleAcomptes({ dues, current: ref(60_000), previous: null, firstOnPrevious: true })
    expect(s.items.map((i) => i.amountCents)).toEqual([null, null, k(2_688), k(2_688)])
  })

  it('a short next year pays as many acomptes as it holds due dates', () => {
    const s = scheduleAcomptes({ dues: dues.slice(0, 3), current: ref(60_000), previous: null, firstOnPrevious: false })
    expect(s.items).toHaveLength(3)
    expect(s.totalCents).toBe(k(3 * 2_688))
  })

  it('the balance is the tax less the acomptes paid, negative for an excess', () => {
    expect(balanceOf(k(10_750), [{ number: 1, paidOn: '2026-03-15', amountCents: k(2_000) }, { number: 2, paidOn: '2026-06-15', amountCents: k(2_000) }])).toEqual({ paidCents: k(4_000), balanceCents: k(6_750) })
    expect(balanceOf(k(1_000), [{ number: 1, paidOn: '2026-03-15', amountCents: k(2_500) }]).balanceCents).toBe(k(-1_500))
  })

  it('taxAtRates never taxes a loss', () => {
    expect(taxAtRates(k(-5_000), true, k(42_500)).taxCents).toBe(0)
  })
})

describe('checks', () => {
  const base: CheckInput = {
    drafts: { count: 0, numbers: [] },
    unreconciled: { count: 0, totalCents: 0 },
    yearInProgress: false,
    unanswered: [],
    deficitsKnown: true,
    otherDividendsCents: 0,
    unreachableSubsidiaries: 0,
    receptionsCents: 0,
    foreignTaxCents: 0,
    taxGroupCents: 0,
    acomptes: { recordedCents: 0, bookedCents: 0 },
  }

  it('blocks on drafts and unreconciled bank lines only', () => {
    expect(isReliable(corporateTaxChecks(base))).toBe(true)
    const checks = corporateTaxChecks({ ...base, drafts: { count: 2, numbers: ['BR-1', 'BR-2'] }, unreconciled: { count: 1, totalCents: 1_200 }, unanswered: ['Le capital est-il entièrement libéré ?'], deficitsKnown: false })
    expect(checks.filter((c) => c.severity === 'blocking').map((c) => c.id)).toEqual(['drafts', 'bank'])
    expect(checks.find((c) => c.id === 'drafts')?.title).toBe('2 écritures en brouillon sur l’exercice')
    expect(checks.find((c) => c.id === 'reduced-rate')?.severity).toBe('warning')
    expect(checks.find((c) => c.id === 'deficits')?.severity).toBe('warning')
    expect(isReliable(checks)).toBe(false)
  })

  it('flags acomptes recorded and booked that differ, and accounts Kledg cannot judge', () => {
    const checks = corporateTaxChecks({ ...base, acomptes: { recordedCents: 6_000, bookedCents: 4_000 }, receptionsCents: 500, otherDividendsCents: 1_000, taxGroupCents: 10 })
    expect(checks.map((c) => c.id)).toEqual(['drafts', 'bank', 'dividends', 'receptions', 'tax-group', 'acomptes'])
  })
})

describe('links with the deadline calendar', () => {
  it('reads the deadline ids of the engine', () => {
    expect(corporateTaxDeadlineTarget('is-acompte:2027-12-31:2')).toEqual({ kind: 'acompte', exerciceEnd: '2027-12-31', number: 2 })
    expect(corporateTaxDeadlineTarget('is-solde:2026-12-31')).toEqual({ kind: 'solde', exerciceEnd: '2026-12-31' })
    expect(corporateTaxDeadlineTarget('liasse:2026-06-30')).toEqual({ kind: 'liasse', exerciceEnd: '2026-06-30' })
    expect(corporateTaxDeadlineTarget('tva-ca3:2026-09')).toBeNull()
    expect(corporateTaxDeadlineTarget('is-solde:2026-12-31:1')).toBeNull()
  })

  it('links IS deadlines to the worksheet only', () => {
    expect(corporateTaxPageOf({ id: 'is-solde:2026-12-31', ruleId: 'is-solde' })).toBe('impot-societes?echeance=is-solde%3A2026-12-31')
    expect(corporateTaxPageOf({ id: 'cfe:2026', ruleId: 'cfe' })).toBeNull()
  })
})
