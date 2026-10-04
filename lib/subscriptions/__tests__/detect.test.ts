/**
 * Detection of recurring payments (lib/subscriptions/detect.ts), pure:
 * cadences, day jitter, month ends, February and leap years, missed
 * payments, price changes, two plans of one provider, refunds, one-off
 * payments that must not be detected, the status against the last day the
 * lines cover, and the attachment of stored decisions. Fictitious
 * counterparties. Runs under several timezones: days are calendar days.
 */

import { afterAll, describe, expect, it } from 'vitest'
import {
  addCalendarMonths,
  counterpartyKey,
  detectSubscriptions,
  ledgerChargeReason,
  matchDecisions,
  recurringChargeOfText,
  type BankLine,
  type DetectedSubscription,
} from '../detect'

let seq = 0
function debit(day: string, amountCents: number, counterpartyName: string | null = 'Nuage Pro', label: string | null = null): BankLine {
  seq += 1
  return { id: `t${String(seq).padStart(4, '0')}`, day, amountCents, side: 'debit', counterpartyName, label }
}
function credit(day: string, amountCents: number, counterpartyName: string | null = 'Nuage Pro'): BankLine {
  seq += 1
  return { id: `t${String(seq).padStart(4, '0')}`, day, amountCents, side: 'credit', counterpartyName, label: null }
}

const detect = (lines: BankLine[], today = '2026-12-31') => detectSubscriptions(lines, { today })
const only = (lines: BankLine[], today?: string): DetectedSubscription => {
  const { subscriptions } = detect(lines, today)
  expect(subscriptions).toHaveLength(1)
  return subscriptions[0]
}

const ORIGINAL_TZ = process.env.TZ
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe.each(['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC'])('detectSubscriptions with TZ=%s', (zone) => {
  process.env.TZ = zone

  it('detects a monthly payment paid a few days late on weekends', () => {
    process.env.TZ = zone
    // Due on the 5th: 5 Apr 2026 is a Sunday (paid the 6th), 5 Jul a Sunday (paid the 6th)
    const lines = [debit('2026-01-05', 2_990), debit('2026-02-05', 2_990), debit('2026-03-05', 2_990), debit('2026-04-06', 2_990), debit('2026-05-05', 2_990), debit('2026-06-05', 2_990), debit('2026-07-06', 2_990)]
    const sub = only(lines, '2026-07-20')
    expect(sub).toMatchObject({
      id: lines[0].id,
      name: 'Nuage Pro',
      counterpartyKey: 'NUAGE PRO',
      cadence: 'monthly',
      typicalAmountCents: 2_990,
      annualizedCents: 35_880,
      firstDay: '2026-01-05',
      lastDay: '2026-07-06',
      nextExpectedDay: '2026-08-05',
      occurrences: 7,
      missedPayments: 0,
      status: 'active',
      priceChange: null,
      variableAmount: false,
    })
    expect(sub.transactionIds).toEqual(lines.map((l) => l.id))
  })

  it('follows a payment of the 31st through short months and comes back to the 31st', () => {
    process.env.TZ = zone
    const days = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']
    const sub = only(days.map((d) => debit(d, 1_500)), '2026-07-01')
    expect(sub).toMatchObject({ cadence: 'monthly', occurrences: 6, missedPayments: 0, nextExpectedDay: '2026-07-31', status: 'active' })
  })

  it('handles 29 February in a leap year, monthly and yearly', () => {
    process.env.TZ = zone
    const monthly = only(['2024-01-29', '2024-02-29', '2024-03-29', '2024-04-29'].map((d) => debit(d, 900)), '2024-05-01')
    expect(monthly).toMatchObject({ cadence: 'monthly', nextExpectedDay: '2024-05-29' })

    const yearly = only(['2024-02-29', '2025-02-28', '2026-02-28'].map((d) => debit(d, 12_000, 'Assur Bureau')), '2026-06-30')
    expect(yearly).toMatchObject({ cadence: 'yearly', occurrences: 3, typicalAmountCents: 12_000, annualizedCents: 12_000, nextExpectedDay: '2027-02-28', status: 'active' })
  })

  it('keeps the 28th as the billing day after 28 February', () => {
    process.env.TZ = zone
    const sub = only(['2026-01-28', '2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28'].map((d) => debit(d, 700)), '2026-06-30')
    expect(sub.nextExpectedDay).toBe('2026-07-28')
    const afterFebruary = only(['2026-11-28', '2026-12-28', '2027-01-28', '2027-02-28'].map((d) => debit(d, 700)), '2027-03-01')
    expect(afterFebruary.nextExpectedDay).toBe('2027-03-28')
  })

  it('tolerates a missed month and counts it', () => {
    process.env.TZ = zone
    const days = ['2026-01-10', '2026-02-10', '2026-03-10', '2026-05-11', '2026-06-10', '2026-07-10']
    const sub = only(days.map((d) => debit(d, 4_900)), '2026-07-15')
    expect(sub).toMatchObject({ cadence: 'monthly', occurrences: 6, missedPayments: 1, status: 'active' })
  })

  it('refuses a series where too many payments are missing', () => {
    process.env.TZ = zone
    // Four payments over ten months: not a monthly subscription, and the gaps are not a quarterly rhythm either
    expect(detect(['2026-01-10', '2026-03-10', '2026-06-10', '2026-08-10'].map((d) => debit(d, 4_900))).subscriptions).toEqual([])
  })

  it('detects weekly and quarterly cadences', () => {
    process.env.TZ = zone
    const weekly = only(['2026-03-02', '2026-03-09', '2026-03-17', '2026-03-23', '2026-03-30', '2026-04-06'].map((d) => debit(d, 2_500, 'Panier Frais')), '2026-04-07')
    expect(weekly).toMatchObject({ cadence: 'weekly', occurrences: 6, annualizedCents: 130_000, nextExpectedDay: '2026-04-13' })

    const quarterly = only(['2025-10-15', '2026-01-15', '2026-04-14', '2026-07-15'].map((d) => debit(d, 36_000, 'Maintenance Clim')), '2026-08-01')
    expect(quarterly).toMatchObject({ cadence: 'quarterly', occurrences: 4, annualizedCents: 144_000, nextExpectedDay: '2026-10-15' })
  })

  it('separates two subscriptions of the same counterparty with different amounts', () => {
    process.env.TZ = zone
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']
    // Far apart amounts: two groups
    const far = detect(months.flatMap((m) => [debit(`${m}-03`, 999), debit(`${m}-03`, 4_900)]), '2026-05-10').subscriptions
    expect(far.map((s) => [s.cadence, s.typicalAmountCents, s.occurrences])).toEqual([
      ['monthly', 4_900, 5],
      ['monthly', 999, 5],
    ])
    // Close amounts billed the same week: the group is irregular, split by exact amount
    const close = detect(months.flatMap((m) => [debit(`${m}-03`, 1_000), debit(`${m}-07`, 1_200)]), '2026-05-10').subscriptions
    expect(close.map((s) => [s.typicalAmountCents, s.occurrences, s.firstDay])).toEqual([
      [1_200, 5, '2026-01-07'],
      [1_000, 5, '2026-01-03'],
    ])
    expect(new Set([...close[0].transactionIds, ...close[1].transactionIds]).size).toBe(10)
  })

  it('reports a price increase as a price change, then as active once it is the usual price', () => {
    process.env.TZ = zone
    const recent = only(['2026-01-12', '2026-02-12', '2026-03-12', '2026-04-12', '2026-05-12', '2026-06-12'].map((d, i) => debit(d, i < 4 ? 1_000 : 1_200)), '2026-06-20')
    expect(recent).toMatchObject({
      status: 'price_changed',
      typicalAmountCents: 1_200,
      annualizedCents: 14_400,
      priceChange: { previousAmountCents: 1_000, newAmountCents: 1_200, sinceDay: '2026-05-12' },
      variableAmount: false,
    })
    const settled = only(['2026-01-12', '2026-02-12', '2026-03-12', '2026-04-12', '2026-05-12', '2026-06-12'].map((d, i) => debit(d, i < 2 ? 1_000 : 1_200)), '2026-06-20')
    expect(settled.status).toBe('active')
    expect(settled.priceChange).toMatchObject({ previousAmountCents: 1_000, newAmountCents: 1_200, sinceDay: '2026-03-12' })
  })

  it('keeps a variable amount (energy bill) as one subscription, typical amount the median of the last three', () => {
    process.env.TZ = zone
    const amounts = [8_000, 8_600, 7_900, 9_100, 8_400, 8_800]
    const sub = only(amounts.map((a, i) => debit(`2026-0${i + 1}-20`, a, 'Energie Verte')), '2026-06-25')
    expect(sub).toMatchObject({ cadence: 'monthly', variableAmount: true, priceChange: null, typicalAmountCents: 8_800, status: 'active' })
  })

  it('treats a foreign currency card payment moving by a few cents as one price', () => {
    process.env.TZ = zone
    const sub = only([2_013, 2_008, 2_019, 2_011].map((a, i) => debit(`2026-0${i + 1}-02`, a, 'Design Tool Inc')), '2026-04-10')
    expect(sub).toMatchObject({ variableAmount: false, priceChange: null, typicalAmountCents: 2_011 })
  })

  it('marks a series possibly stopped when the next payment is overdue at the last day the lines cover', () => {
    process.env.TZ = zone
    const series = ['2026-01-08', '2026-02-08', '2026-03-08', '2026-04-08'].map((d) => debit(d, 1_990))
    // Lines of other counterparties go on until July: the payment due on 8 May never came
    const later = [debit('2026-07-15', 12_345, 'Fournisseur Ponctuel')]
    const { observedUntil, subscriptions } = detect([...series, ...later], '2026-10-01')
    expect(observedUntil).toBe('2026-07-15')
    expect(subscriptions).toHaveLength(1)
    expect(subscriptions[0]).toMatchObject({ status: 'possibly_stopped', nextExpectedDay: '2026-05-08' })
    // Within the margin, or with no line after the last payment, it is still active
    expect(only([...series, debit('2026-05-15', 100, 'Autre')]).status).toBe('active')
    expect(only(series).status).toBe('active')
  })

  it('never detects credits, and cancels a refunded double charge', () => {
    process.env.TZ = zone
    const incoming = ['2026-01-03', '2026-02-03', '2026-03-03', '2026-04-03'].map((d) => credit(d, 50_000, 'Client Fidele'))
    expect(detect(incoming).subscriptions).toEqual([])

    const days = ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15']
    const charged = days.map((d) => debit(d, 3_000))
    const doubleCharge = debit('2026-03-16', 3_000)
    const refund = credit('2026-03-20', 3_000)
    const sub = only([...charged, doubleCharge, refund], '2026-05-20')
    expect(sub.occurrences).toBe(5)
    expect(sub.transactionIds).not.toContain(doubleCharge.id)
    // Without the refund the extra charge breaks the rhythm: no exact amount split can save it
    expect(detect([...charged, doubleCharge], '2026-05-20').subscriptions).toEqual([])
  })

  it('does not detect one-off payments', () => {
    process.env.TZ = zone
    const lines = [
      debit('2026-02-11', 89_000, 'Mobilier Express'),
      // Two payments a month apart: not enough for a monthly series
      debit('2026-03-01', 4_500, 'Imprimerie Locale'),
      debit('2026-03-31', 4_500, 'Imprimerie Locale'),
      // Two purchases a year apart at different prices: not a yearly subscription
      debit('2025-05-20', 30_000, 'Salon Pro'),
      debit('2026-05-22', 34_000, 'Salon Pro'),
      // Irregular purchases at one shop
      debit('2026-01-04', 2_300, 'Papeterie Centrale'),
      debit('2026-01-19', 2_300, 'Papeterie Centrale'),
      debit('2026-03-27', 2_300, 'Papeterie Centrale'),
      debit('2026-04-02', 2_300, 'Papeterie Centrale'),
      // No counterparty and a label made only of references
      debit('2026-01-05', 1_000, null, 'CB 0501 1234'),
      debit('2026-02-05', 1_000, null, 'CB 0502 1234'),
      debit('2026-03-05', 1_000, null, 'CB 0503 1234'),
    ]
    expect(detect(lines).subscriptions).toEqual([])
  })

  it('groups lines without counterparty by the stable start of their label', () => {
    process.env.TZ = zone
    const lines = [
      debit('2026-01-02', 5_900, null, 'PRLV SEPA HEBERGEUR WEB 01/2026 REF 88123'),
      debit('2026-02-02', 5_900, null, 'PRLV SEPA HEBERGEUR WEB 02/2026 REF 88456'),
      debit('2026-03-02', 5_900, null, 'Prlv Sepa Hébergeur Web 03/2026 ref 88789'),
    ]
    expect(only(lines, '2026-03-10')).toMatchObject({ counterpartyKey: 'HEBERGEUR WEB', name: 'Prlv Sepa Hébergeur Web 03/2026 ref 88789', occurrences: 3 })
  })

  it('ignores lines after today and invalid lines, and sorts by annualized cost', () => {
    process.env.TZ = zone
    const small = ['2026-01-04', '2026-02-04', '2026-03-04'].map((d) => debit(d, 500, 'Petit Outil'))
    const big = ['2026-01-09', '2026-02-09', '2026-03-09'].map((d) => debit(d, 9_000, 'Gros Logiciel'))
    const future = debit('2026-04-04', 500, 'Petit Outil')
    const broken = [{ ...debit('2026-02-30', 500, 'Petit Outil') }, { ...debit('2026-02-10', 0, 'Petit Outil') }]
    const { subscriptions } = detect([...small, ...big, future, ...broken], '2026-03-20')
    expect(subscriptions.map((s) => [s.name, s.occurrences])).toEqual([
      ['Gros Logiciel', 3],
      ['Petit Outil', 3],
    ])
    expect(detect([], '2026-03-20')).toEqual({ observedUntil: null, subscriptions: [] })
  })

  it('is deterministic whatever the order of the lines', () => {
    process.env.TZ = zone
    const lines = [
      ...['2026-01-03', '2026-02-03', '2026-03-03'].map((d) => debit(d, 999, 'Alpha')),
      ...['2026-01-08', '2026-02-08', '2026-03-08'].map((d) => debit(d, 999, 'Beta')),
    ]
    expect(detect([...lines].reverse(), '2026-03-10')).toEqual(detect(lines, '2026-03-10'))
  })
})

describe('recurring charges that are not subscriptions', () => {
  const monthly = (name: string | null, label: string | null, ledgerClass?: BankLine['ledgerClass'], amountCents = 260_000) =>
    ['2026-01-15', '2026-02-15', '2026-03-16', '2026-04-15'].map((day, i) => ({ ...debit(day, amountCents, name, label), ledgerClass: i === 3 ? ledgerClass : undefined }))

  it('classifies an account of the reconciled entry: 16, 42, 43, 44 and 455 are not subscriptions, rent and insurance are', () => {
    expect(['164000', '421000', '425000', '431000', '437000', '444000', '445510', '447000', '455100'].map(ledgerChargeReason)).toEqual([
      'loans', 'personnel', 'personnel', 'social', 'social', 'state', 'state', 'state', 'associates',
    ])
    expect(['613200', '616000', '401000', '626000', '451000', '6411'].map(ledgerChargeReason)).toEqual(['other', 'other', 'other', 'other', 'other', 'other'])
  })

  it('reports a series booked to a salary account as a recurring charge, whatever its name', () => {
    const [salary] = detect(monthly('Président', 'VIR PRESIDENT', 'personnel', 312_000)).subscriptions
    expect(salary).toMatchObject({ cadence: 'monthly', typicalAmountCents: 312_000, kind: 'recurring_charge', chargeReason: 'personnel', classifiedBy: 'ledger' })
  })

  it('falls back on payroll and tax payees in the counterparty or label of unreconciled lines', () => {
    expect(detect(monthly(null, 'PRLV SEPA URSSAF ILE DE FRANCE 012026')).subscriptions[0]).toMatchObject({ kind: 'recurring_charge', chargeReason: 'social', classifiedBy: 'label' })
    expect(detect(monthly('DGFIP', 'PRLV IMPOT SOCIETES')).subscriptions[0]).toMatchObject({ kind: 'recurring_charge', chargeReason: 'state' })
    expect(detect(monthly(null, 'VIR SALAIRE MARS DUPONT')).subscriptions[0]).toMatchObject({ kind: 'recurring_charge', chargeReason: 'personnel' })
    const tokens: Array<[string | null, string | null]> = [
      [null, 'PRLV IMPOTS.GOUV TVA'],
      ['AGIRC-ARRCO', null],
      [null, 'CAISSE RETRAITE COMPLEMENTAIRE CADRES'],
      ['France Travail', null],
      [null, 'POLE EMPLOI CONTRIBUTION'],
      ['Trésor Public', null],
    ]
    expect(tokens.map(([name, label]) => recurringChargeOfText(name, label))).toEqual(['state', 'social', 'social', 'social', 'social', 'state'])
    // Whole words only, and software named after payroll stays a subscription
    expect([['Logiciel Paie', null], ['Salairetech', null], [null, 'MUTUELLE SANTE ENTREPRISE']].map(([n, l]) => recurringChargeOfText(n, l))).toEqual([null, null, null])
  })

  it('lets the account of the latest reconciled payment override the label, both ways', () => {
    // A rent whose label happens to mention taxes, reconciled on 613: a subscription
    expect(detect(monthly('Bailleur', 'LOYER ET IMPOTS FONCIERS', 'other')).subscriptions[0]).toMatchObject({ kind: 'subscription', chargeReason: null, classifiedBy: 'ledger' })
    // Nothing in the label, reconciled on 431: a recurring charge
    expect(detect(monthly('Caisse Sociale', null, 'social')).subscriptions[0]).toMatchObject({ kind: 'recurring_charge', classifiedBy: 'ledger' })
    // Neither: a subscription by default
    expect(detect(monthly('Nuage Pro', null)).subscriptions[0]).toMatchObject({ kind: 'subscription', chargeReason: null, classifiedBy: null })
  })
})

describe('addCalendarMonths', () => {
  it('clamps to the end of shorter months and keeps the intended day', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addCalendarMonths('2026-02-28', 1)).toBe('2026-03-31')
    expect(addCalendarMonths('2026-02-28', 1, 28)).toBe('2026-03-28')
    expect(addCalendarMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addCalendarMonths('2024-02-29', 12)).toBe('2025-02-28')
  })
})

describe('counterpartyKey', () => {
  it('normalizes the counterparty name and drops legal forms', () => {
    expect(counterpartyKey('Hébergeur Web SAS', 'whatever')).toBe('HEBERGEUR WEB')
    expect(counterpartyKey('  nuage-pro  ', null)).toBe('NUAGE PRO')
  })

  it('falls back on the first stable words of the label', () => {
    expect(counterpartyKey(null, 'CARTE 12/03 LOGICIEL COMPTA PARIS 75 CB*1234')).toBe('LOGICIEL COMPTA PARIS')
    expect(counterpartyKey('', 'VIR SEPA LOYER BUREAU MARS')).toBe('LOYER BUREAU MARS')
    expect(counterpartyKey(null, '0123 4567')).toBe('')
    expect(counterpartyKey(null, null)).toBe('')
  })
})

describe('matchDecisions', () => {
  const sub = (id: string, typicalAmountCents: number, cadence: DetectedSubscription['cadence'] = 'monthly', key = 'NUAGE PRO') =>
    ({ id, counterpartyKey: key, cadence, typicalAmountCents }) as DetectedSubscription

  it('keeps a decision through a price increase', () => {
    expect(matchDecisions([sub('s1', 1_200)], [{ id: 'd1', counterpartyKey: 'NUAGE PRO', cadence: 'monthly', referenceAmountCents: 1_000 }])).toEqual(new Map([['s1', 'd1']]))
  })

  it('gives each of two plans of one provider its own decision, by the closest amount', () => {
    const decisions = [
      { id: 'd-big', counterpartyKey: 'NUAGE PRO', cadence: 'monthly' as const, referenceAmountCents: 4_900 },
      { id: 'd-small', counterpartyKey: 'NUAGE PRO', cadence: 'monthly' as const, referenceAmountCents: 1_000 },
    ]
    expect(matchDecisions([sub('s1', 1_100), sub('s2', 4_900)], decisions)).toEqual(new Map([['s2', 'd-big'], ['s1', 'd-small']]))
  })

  it('never attaches a decision to another cadence, counterparty or an amount more than half apart', () => {
    const decision = [{ id: 'd1', counterpartyKey: 'NUAGE PRO', cadence: 'monthly' as const, referenceAmountCents: 1_000 }]
    expect(matchDecisions([sub('s1', 1_000, 'yearly')], decision).size).toBe(0)
    expect(matchDecisions([sub('s1', 1_000, 'monthly', 'AUTRE')], decision).size).toBe(0)
    expect(matchDecisions([sub('s1', 2_500)], decision).size).toBe(0)
  })
})
