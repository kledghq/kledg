/**
 * Detection of recurring payments (abonnements) in a company's bank lines
 * (docs/abonnements.md). Pure and deterministic: the same lines and the same
 * day always give the same subscriptions, in the same order. No imports, so
 * the page can share its types and labels.
 *
 * A subscription is a series of debits to the same counterparty that falls
 * due at a regular cadence (weekly, monthly, quarterly, yearly) for an
 * amount that stays the same or changes rarely (a price increase):
 *
 * 1. Lines: debits and credits up to `today`, amounts in absolute cents. A
 *    credit of the same counterparty and amount within 45 days after a debit
 *    is a refund: it cancels that debit (one to one), so a charge taken
 *    twice and refunded once counts once. Credits are never subscriptions.
 * 2. Counterparty key: the bank's counterparty name when it has one, else
 *    the start of the label without what changes from one payment to the
 *    next (dates, references, card numbers, "PRLV SEPA").
 * 3. Amount groups: amounts of a counterparty within 25 % of each other
 *    chain into one group (a price increase stays in its series); two
 *    subscriptions far apart in amount are two groups. A group whose dates
 *    are not regular (two plans of the same provider billed in the same
 *    month) is split by exact amount and each part is tried on its own.
 * 4. Cadence: each gap between two payments must be a whole number of
 *    periods give or take a tolerance (weekends, bank holidays, months of 28
 *    to 31 days). Months are calendar months: a payment on the 31st falls
 *    on the 28th or 29th in February and on the 30th in April, and comes
 *    back to the 31st after. A missed payment is a gap of two periods; at
 *    most a quarter of the periods may be missed.
 * 5. Status: possibly stopped when the next payment is overdue by a margin
 *    at the last day the bank lines cover (not today: lines imported
 *    monthly would make everything look overdue); price changed when the
 *    amount moved once and the new amount has been paid at most three times.
 * 6. Kind: salaries, social charges, taxes, associates' current accounts and
 *    loan repayments recur but are not subscriptions. They are reported as
 *    recurring charges (kind `recurring_charge`), never dropped, so a user
 *    still sees them and can count one as a subscription. The account a
 *    reconciled payment was booked to decides (`ledgerClass`, given by the
 *    caller from the reconciliation entry, latest classified payment
 *    first); a series without any reconciled payment falls back on a
 *    conservative list of French payroll and tax payees in the counterparty
 *    or label (`recurringChargeOfText`).
 */

export const SUBSCRIPTION_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const
export type SubscriptionCadence = (typeof SUBSCRIPTION_CADENCES)[number]

export const CADENCE_LABELS: Record<SubscriptionCadence, string> = {
  weekly: 'Hebdomadaire',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
  yearly: 'Annuel',
}

export type SubscriptionStatus = 'active' | 'price_changed' | 'possibly_stopped'

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Actif',
  price_changed: 'Prix modifié',
  possibly_stopped: 'Peut-être arrêté',
}

/** A bank line as the detection reads it. */
export interface BankLine {
  id: string
  /** Booking day, yyyy-mm-dd. */
  day: string
  /** Absolute amount in cents. */
  amountCents: number
  side: 'debit' | 'credit'
  label: string | null
  counterpartyName: string | null
  /**
   * What the entry this line is reconciled with books it to: a reason when
   * its counterpart account is not a subscription (ledgerChargeReason),
   * 'other' for any other account (rent, insurance, a supplier), null or
   * absent when the line is not reconciled.
   */
  ledgerClass?: ChargeReason | 'other' | null
}

/** Why a recurring debit is not a subscription. */
export type ChargeReason = 'personnel' | 'social' | 'state' | 'associates' | 'loans'

export const CHARGE_REASON_LABELS: Record<ChargeReason, string> = {
  personnel: 'Personnel',
  social: 'Organismes sociaux',
  state: 'État, impôts et taxes',
  associates: "Comptes courants d'associés",
  loans: 'Emprunts',
}

export type SubscriptionKind = 'subscription' | 'recurring_charge'

/**
 * Accounts whose payments recur without being subscriptions (PCG art.
 * 932-1): 16 emprunts et dettes assimilées, 42 personnel, 43 sécurité
 * sociale et autres organismes sociaux, 44 État et autres collectivités
 * publiques, 455 associés, comptes courants; and the charge accounts a
 * payment is sometimes booked to directly, without a third-party account:
 * 63 impôts et taxes (CFE 63511...), 64 charges de personnel, of which 645,
 * 646 (cotisations personnelles de l'exploitant) and 647 social, 661
 * charges d'intérêts. Longest prefix first: 645 before 64.
 */
const LEDGER_CHARGE_PREFIXES: ReadonlyArray<readonly [string, ChargeReason]> = [
  ['455', 'associates'],
  ['645', 'social'],
  ['646', 'social'],
  ['647', 'social'],
  ['661', 'loans'],
  ['16', 'loans'],
  ['42', 'personnel'],
  ['43', 'social'],
  ['44', 'state'],
  ['63', 'state'],
  ['64', 'personnel'],
]

/** The reason an account is not a subscription's, or 'other' (rent 613, insurance 616, a supplier 401...). */
export function ledgerChargeReason(accountCode: string): ChargeReason | 'other' {
  return LEDGER_CHARGE_PREFIXES.find(([prefix]) => accountCode.startsWith(prefix))?.[1] ?? 'other'
}

/**
 * Payees of salaries, social charges and taxes in French bank labels, as
 * whole words of the normalized text. Conservative on purpose: names that
 * are also insurers or software vendors (complementary health insurance,
 * provident funds, "paie") are left out, the user can ignore those.
 */
const CHARGE_PAYEES: ReadonlyArray<readonly [string, ChargeReason]> = [
  ['SALAIRE', 'personnel'],
  ['SALAIRES', 'personnel'],
  ['URSSAF', 'social'],
  ['AGIRC', 'social'],
  ['ARRCO', 'social'],
  ['RETRAITE COMPLEMENTAIRE', 'social'],
  ['POLE EMPLOI', 'social'],
  ['FRANCE TRAVAIL', 'social'],
  ['DGFIP', 'state'],
  ['IMPOTS', 'state'],
  ['IMPOT', 'state'],
  ['TRESOR PUBLIC', 'state'],
  ['FINANCES PUBLIQUES', 'state'],
]

/** The reason a counterparty or label names a payroll, social or tax payee, or null. */
export function recurringChargeOfText(counterpartyName: string | null, label: string | null): ChargeReason | null {
  const text = ` ${words(`${counterpartyName ?? ''} ${label ?? ''}`).join(' ')} `
  return CHARGE_PAYEES.find(([payee]) => text.includes(` ${payee} `))?.[1] ?? null
}

export interface PriceChange {
  previousAmountCents: number
  newAmountCents: number
  /** Day of the first payment at the new amount. */
  sinceDay: string
}

export interface DetectedSubscription {
  /** Id of the first payment of the series: stable while the series is in the lines read. */
  id: string
  /** Normalized counterparty: what decisions are attached to. */
  counterpartyKey: string
  /** The counterparty as the bank writes it (latest payment). */
  name: string
  cadence: SubscriptionCadence
  /** Current amount in cents: the new amount after a price change, else the median of the last three payments. */
  typicalAmountCents: number
  /** Typical amount times the payments of a year (52 weeks, 12 months, 4 quarters, 1 year). */
  annualizedCents: number
  firstDay: string
  lastDay: string
  nextExpectedDay: string
  occurrences: number
  /** Payments expected between the first and the last one that did not happen. */
  missedPayments: number
  status: SubscriptionStatus
  priceChange: PriceChange | null
  /** The amount moved more than once (an energy bill, a usage based plan). */
  variableAmount: boolean
  /** A subscription, or a recurring charge that is not one (salary, social charges, taxes, loan). */
  kind: SubscriptionKind
  /** Why it is a recurring charge, null for a subscription. */
  chargeReason: ChargeReason | null
  /** What told: the account of a reconciled payment, the counterparty or label, or nothing (a subscription by default). */
  classifiedBy: 'ledger' | 'label' | null
  /** Payments of the series, oldest first. */
  transactionIds: string[]
}

export interface DetectionResult {
  /** Last day covered by the bank lines read (status reference), null without lines. */
  observedUntil: string | null
  subscriptions: DetectedSubscription[]
}

interface CadenceRule {
  /** Calendar months per period, or 0 for weeks. */
  months: number
  /** Approximate days per period, to guess the number of periods of a gap. */
  days: number
  /** Days a payment may be early or late. */
  tolerance: number
  /** Most periods one gap may span (2 = one missed payment). */
  maxGap: number
  minOccurrences: number
  perYear: number
  /** Days after the expected payment before the series is possibly stopped. */
  stopMargin: number
}

/** Tried in this order: a shorter cadence is preferred when two fit (a monthly series never fits a longer one anyway). */
const CADENCES: Record<SubscriptionCadence, CadenceRule> = {
  weekly: { months: 0, days: 7, tolerance: 2, maxGap: 3, minOccurrences: 4, perYear: 52, stopMargin: 5 },
  monthly: { months: 1, days: 30.44, tolerance: 5, maxGap: 3, minOccurrences: 3, perYear: 12, stopMargin: 10 },
  quarterly: { months: 3, days: 91.31, tolerance: 8, maxGap: 2, minOccurrences: 3, perYear: 4, stopMargin: 20 },
  yearly: { months: 12, days: 365.25, tolerance: 10, maxGap: 1, minOccurrences: 2, perYear: 1, stopMargin: 30 },
}

/** Share of the expected payments that may be missing. */
const MAX_MISSED_SHARE = 0.25
/** Amounts of one series may differ by this ratio between neighbours (sorted). */
const AMOUNT_GROUP_RATIO = 1.25
/** Two amounts are the same price within 1 % (card payments in a foreign currency move by a few cents). */
const SAME_PRICE_PERCENT = 1
/** A refund follows its debit by at most this many days. */
const REFUND_WINDOW_DAYS = 45
/** A price change is news while the new amount has been paid at most this many times. */
const RECENT_PRICE_CHANGE_PAYMENTS = 3

// ---------------------------------------------------------------------------
// Calendar days (UTC day numbers, never local time)

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function dayNumber(day: string): number {
  const match = ISO_DAY.exec(day)
  if (!match) throw new RangeError(`Invalid calendar day: ${day}`)
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000
}

function dayOfNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10)
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

function isValidDay(day: string): boolean {
  const match = ISO_DAY.exec(day)
  if (!match) return false
  const month = Number(match[2])
  return month >= 1 && month <= 12 && Number(match[3]) >= 1 && Number(match[3]) <= daysInMonth(Number(match[1]), month - 1)
}

/**
 * The day of the month a payment is meant for: its own day, or 31 when it is
 * the last day of its month (a payment of the 31st paid on 28 February).
 */
function intendedDayOfMonth(day: string): number {
  const [year, month, dom] = day.split('-').map(Number)
  return dom === daysInMonth(year, month - 1) ? 31 : dom
}

/**
 * `months` calendar months after `day`, on `dayOfMonth` (by default the
 * intended day of `day`), clamped to the length of the month reached.
 */
export function addCalendarMonths(day: string, months: number, dayOfMonth = intendedDayOfMonth(day)): string {
  const [year, month] = day.split('-').map(Number)
  const target = month - 1 + months
  const targetYear = year + Math.floor(target / 12)
  const targetMonth = ((target % 12) + 12) % 12
  const dom = Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth))
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(dom).padStart(2, '0')}`
}

function nextDue(day: string, rule: CadenceRule, periods = 1, dayOfMonth?: number): string {
  return rule.months === 0 ? dayOfNumber(dayNumber(day) + 7 * periods) : addCalendarMonths(day, rule.months * periods, dayOfMonth)
}

/**
 * Day of the month a series is billed on: the most frequent day among its
 * payments that are not the last day of their month (the later one on a
 * tie), or 31 when every payment is (a series of the 31st). A payment due on
 * the 28th and paid on 28 February is next due on 28 March, not the 31st.
 */
function billingDayOfMonth(days: readonly string[]): number {
  const counts = new Map<number, number>()
  for (const day of days) {
    if (intendedDayOfMonth(day) === 31) continue
    const dom = Number(day.slice(8, 10))
    counts.set(dom, (counts.get(dom) ?? 0) + 1)
  }
  let best = 31
  let bestCount = 0
  for (const [dom, count] of counts) {
    if (count > bestCount || (count === bestCount && dom > best)) {
      best = dom
      bestCount = count
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Counterparty

/** Words of bank labels that name the payment method or a legal form, not the counterparty. */
const LABEL_NOISE = new Set([
  'PRLV', 'PRELEVEMENT', 'PRELEVEMENTS', 'PRELEV', 'SEPA', 'SDD', 'CB', 'CARTE', 'PAIEMENT', 'PAIEMENTS', 'ACHAT', 'VIR', 'VIREMENT',
  'VIREMENTS', 'INST', 'INSTANTANE', 'PERMANENT', 'EMIS', 'RECU', 'ECH', 'ECHEANCE', 'FACTURE', 'FACT', 'REF', 'MANDAT', 'RUM', 'ICS',
  'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'ET', 'POUR', 'SAS', 'SASU', 'SARL', 'EURL', 'SA', 'SCI', 'WWW', 'COM', 'FR', 'EU',
])

/** Words of the label kept for the key: the counterparty comes first, references after. */
const LABEL_KEY_WORDS = 3

/** Words of a bank text: accents removed, uppercase, letters and digits only (shared with lib/simple/payees.ts). */
export function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * Key grouping the payments of one counterparty: the bank's counterparty
 * name without legal forms when there is one, else the first words of the
 * label without payment words, numbers and single letters. '' when nothing
 * is left (the line is not grouped).
 */
export function counterpartyKey(counterpartyName: string | null, label: string | null): string {
  const named = counterpartyName ? words(counterpartyName).filter((w) => !LABEL_NOISE.has(w)) : []
  if (named.length > 0) return named.join(' ')
  const fromLabel = label ? words(label).filter((w) => w.length > 1 && !/\d/.test(w) && !LABEL_NOISE.has(w)) : []
  return fromLabel.slice(0, LABEL_KEY_WORDS).join(' ')
}

// ---------------------------------------------------------------------------
// Detection

interface KeyedLine extends BankLine {
  key: string
  n: number
}

const byDayThenId = (a: KeyedLine, b: KeyedLine) => a.n - b.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) * 100 <= SAME_PRICE_PERCENT * Math.max(a, b)
}

/** Debits left once each refund cancelled the latest unmatched debit it follows (same key and amount, within the window). */
function withoutRefunded(lines: readonly KeyedLine[]): KeyedLine[] {
  const debits = lines.filter((l) => l.side === 'debit')
  const credits = lines.filter((l) => l.side === 'credit')
  const cancelled = new Set<string>()
  for (const credit of credits) {
    let match: KeyedLine | null = null
    for (const debit of debits) {
      if (cancelled.has(debit.id) || debit.key !== credit.key || debit.amountCents !== credit.amountCents) continue
      if (debit.n > credit.n || credit.n - debit.n > REFUND_WINDOW_DAYS) continue
      if (!match || byDayThenId(debit, match) > 0) match = debit
    }
    if (match) cancelled.add(match.id)
  }
  return debits.filter((d) => !cancelled.has(d.id))
}

/** Lines of one counterparty in groups of neighbouring amounts (sorted amounts within AMOUNT_GROUP_RATIO), each by date. */
function amountGroups(lines: readonly KeyedLine[]): KeyedLine[][] {
  const amounts = [...new Set(lines.map((l) => l.amountCents))].sort((a, b) => a - b)
  const groupOf = new Map<number, number>()
  let group = 0
  amounts.forEach((amount, i) => {
    if (i > 0 && amount > amounts[i - 1] * AMOUNT_GROUP_RATIO) group += 1
    groupOf.set(amount, group)
  })
  const groups: KeyedLine[][] = Array.from({ length: group + 1 }, () => [])
  for (const line of lines) groups[groupOf.get(line.amountCents) as number].push(line)
  return groups.map((g) => [...g].sort(byDayThenId))
}

/** Periods between two payments under a cadence, or null when the gap is not a whole number of periods within the tolerance. */
function periodsBetween(previous: string, next: string, rule: CadenceRule): number | null {
  const gap = dayNumber(next) - dayNumber(previous)
  const guess = Math.round(gap / rule.days)
  let best: { periods: number; residual: number } | null = null
  for (const periods of [guess - 1, guess, guess + 1]) {
    if (periods < 1 || periods > rule.maxGap) continue
    const residual = Math.abs(dayNumber(next) - dayNumber(nextDue(previous, rule, periods)))
    if (residual <= rule.tolerance && (!best || residual < best.residual)) best = { periods, residual }
  }
  return best ? best.periods : null
}

/** Missed payments of the series under the cadence, or null when it does not follow it. */
function fitCadence(series: readonly KeyedLine[], rule: CadenceRule): number | null {
  if (series.length < rule.minOccurrences) return null
  let periods = 0
  for (let i = 1; i < series.length; i++) {
    const p = periodsBetween(series[i - 1].day, series[i].day, rule)
    if (p === null) return null
    periods += p
  }
  const missed = periods - (series.length - 1)
  return missed <= MAX_MISSED_SHARE * periods ? missed : null
}

/** Runs of the same price, in payment order. */
function priceRuns(amounts: readonly number[]): number[][] {
  const runs: number[][] = []
  for (const amount of amounts) {
    const run = runs[runs.length - 1]
    if (run && samePrice(run[0], amount)) run.push(amount)
    else runs.push([amount])
  }
  return runs
}

function medianOfLastThree(amounts: readonly number[]): number {
  const last = amounts.slice(-3)
  if (last.length < 3) return last[last.length - 1]
  return [...last].sort((a, b) => a - b)[1]
}

/** Kind of a series: the latest payment whose account is known decides, else the payees of the labels. */
function classify(series: readonly KeyedLine[]): Pick<DetectedSubscription, 'kind' | 'chargeReason' | 'classifiedBy'> {
  const booked = [...series].reverse().find((l) => l.ledgerClass)
  if (booked?.ledgerClass) {
    return booked.ledgerClass === 'other'
      ? { kind: 'subscription', chargeReason: null, classifiedBy: 'ledger' }
      : { kind: 'recurring_charge', chargeReason: booked.ledgerClass, classifiedBy: 'ledger' }
  }
  const reason = [...series].reverse().map((l) => recurringChargeOfText(l.counterpartyName, l.label)).find(Boolean)
  return reason ? { kind: 'recurring_charge', chargeReason: reason, classifiedBy: 'label' } : { kind: 'subscription', chargeReason: null, classifiedBy: null }
}

function describe(series: readonly KeyedLine[], cadence: SubscriptionCadence, missed: number, observedUntil: string): DetectedSubscription {
  const rule = CADENCES[cadence]
  const amounts = series.map((l) => l.amountCents)
  const runs = priceRuns(amounts)
  const last = series[series.length - 1]
  let priceChange: PriceChange | null = null
  if (runs.length === 2) {
    const sinceIndex = runs[0].length
    priceChange = { previousAmountCents: runs[0][runs[0].length - 1], newAmountCents: amounts[amounts.length - 1], sinceDay: series[sinceIndex].day }
  }
  const typicalAmountCents = priceChange ? priceChange.newAmountCents : medianOfLastThree(amounts)
  const nextExpectedDay = nextDue(last.day, rule, 1, rule.months === 0 ? undefined : billingDayOfMonth(series.map((l) => l.day)))
  const overdue = dayNumber(observedUntil) - dayNumber(nextExpectedDay) > rule.stopMargin
  const recentChange = priceChange !== null && runs[1].length <= RECENT_PRICE_CHANGE_PAYMENTS
  const named = [...series].reverse().find((l) => l.counterpartyName?.trim())
  const labelled = [...series].reverse().find((l) => l.label?.trim())
  return {
    id: series[0].id,
    counterpartyKey: series[0].key,
    name: (named?.counterpartyName ?? labelled?.label ?? series[0].key).trim(),
    cadence,
    typicalAmountCents,
    annualizedCents: typicalAmountCents * rule.perYear,
    firstDay: series[0].day,
    lastDay: last.day,
    nextExpectedDay,
    occurrences: series.length,
    missedPayments: missed,
    status: overdue ? 'possibly_stopped' : recentChange ? 'price_changed' : 'active',
    priceChange,
    variableAmount: runs.length > 2,
    ...classify(series),
    transactionIds: series.map((l) => l.id),
  }
}

function detectSeries(series: readonly KeyedLine[], observedUntil: string): DetectedSubscription | null {
  // Two payments are a series only at the same price: two purchases a year apart are not a subscription
  if (series.length < 3 && priceRuns(series.map((l) => l.amountCents)).length > 1) return null
  for (const cadence of SUBSCRIPTION_CADENCES) {
    const missed = fitCadence(series, CADENCES[cadence])
    if (missed !== null) return describe(series, cadence, missed, observedUntil)
  }
  return null
}

/**
 * Recurring debits of the lines, as of `today` (yyyy-mm-dd): lines after
 * `today` and lines with an invalid day or amount are ignored. Sorted by
 * annualized cost, highest first, then by name and id.
 */
export function detectSubscriptions(lines: readonly BankLine[], options: { today: string }): DetectionResult {
  const today = dayNumber(options.today)
  const keyed: KeyedLine[] = []
  let observed: number | null = null
  for (const line of lines) {
    if (!isValidDay(line.day) || !Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) continue
    const n = dayNumber(line.day)
    if (n > today) continue
    observed = observed === null ? n : Math.max(observed, n)
    const key = counterpartyKey(line.counterpartyName, line.label)
    if (key) keyed.push({ ...line, key, n })
  }
  if (observed === null) return { observedUntil: null, subscriptions: [] }
  const observedUntil = dayOfNumber(observed)

  const byKey = new Map<string, KeyedLine[]>()
  for (const line of [...keyed].sort(byDayThenId)) {
    const list = byKey.get(line.key)
    if (list) list.push(line)
    else byKey.set(line.key, [line])
  }

  const subscriptions: DetectedSubscription[] = []
  for (const key of [...byKey.keys()].sort()) {
    for (const group of amountGroups(withoutRefunded(byKey.get(key) as KeyedLine[]))) {
      const whole = detectSeries(group, observedUntil)
      if (whole) {
        subscriptions.push(whole)
        continue
      }
      const exact = [...new Set(group.map((l) => l.amountCents))]
      if (exact.length < 2) continue
      for (const amount of exact.sort((a, b) => a - b)) {
        const part = detectSeries(group.filter((l) => l.amountCents === amount), observedUntil)
        if (part) subscriptions.push(part)
      }
    }
  }
  subscriptions.sort((a, b) => b.annualizedCents - a.annualizedCents || a.name.localeCompare(b.name, 'fr') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { observedUntil, subscriptions }
}

// ---------------------------------------------------------------------------
// Decisions

export interface DecisionKey {
  id: string
  counterpartyKey: string
  cadence: SubscriptionCadence
  referenceAmountCents: number
}

/** Amounts further apart than this share of the larger one are not the same subscription. */
const DECISION_MAX_DISTANCE = 0.5

/**
 * Attaches each stored decision to at most one detected subscription and
 * back: same counterparty key and cadence, the closest amount first (a price
 * increase keeps its decision, two plans of the same provider keep theirs),
 * never amounts more than half apart. Returns decision ids by subscription id.
 */
export function matchDecisions(subscriptions: readonly DetectedSubscription[], decisions: readonly DecisionKey[]): Map<string, string> {
  const pairs: Array<{ sub: string; decision: string; distance: number }> = []
  for (const sub of subscriptions) {
    for (const decision of decisions) {
      if (decision.counterpartyKey !== sub.counterpartyKey || decision.cadence !== sub.cadence) continue
      const larger = Math.max(sub.typicalAmountCents, decision.referenceAmountCents)
      const distance = larger === 0 ? 0 : Math.abs(sub.typicalAmountCents - decision.referenceAmountCents) / larger
      if (distance <= DECISION_MAX_DISTANCE) pairs.push({ sub: sub.id, decision: decision.id, distance })
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0) || (a.decision < b.decision ? -1 : a.decision > b.decision ? 1 : 0))
  const result = new Map<string, string>()
  const used = new Set<string>()
  for (const pair of pairs) {
    if (result.has(pair.sub) || used.has(pair.decision)) continue
    result.set(pair.sub, pair.decision)
    used.add(pair.decision)
  }
  return result
}
