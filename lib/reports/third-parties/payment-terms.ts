/**
 * Payment terms and due dates of the aged balance (balance âgée). Pure
 * module without imports: the settings form, the reports and their tests
 * share it.
 *
 * Code de commerce art. L441-10, I:
 * - al. 1: unless agreed otherwise, payment is due on the thirtieth day
 *   after the goods are received or the service performed: the default
 *   here is 30 days after the invoice date (Kledg knows the invoice, its
 *   entry date, not the delivery);
 * - al. 2: the agreed term "ne peut dépasser soixante jours à compter de la
 *   date d'émission de la facture", or "quarante-cinq jours fin de mois"
 *   when expressly agreed.
 * Terms above those caps are refused when saved and capped when computed.
 *
 * "45 jours fin de mois": the DGCCRF admits two ways to count it; Kledg
 * adds the days to the invoice date then takes the end of that month
 * (10 January + 45 days = 24 February, due 28 February), the shorter one,
 * so a due date is never later than the law allows under either reading.
 */

export interface PaymentTerms {
  /** Days after the invoice date. */
  days: number
  /** Then the end of the month reached ("fin de mois"). */
  endOfMonth: boolean
}

/** L441-10, I, al. 1: 30 days when nothing else is agreed. */
export const DEFAULT_PAYMENT_TERMS: PaymentTerms = { days: 30, endOfMonth: false }
/** L441-10, I, al. 2: at most 60 days from the invoice date. */
export const MAX_PAYMENT_DAYS = 60
/** L441-10, I, al. 2: or at most 45 days end of month, when agreed. */
export const MAX_END_OF_MONTH_DAYS = 45

const LEGAL_SOURCE = 'Code de commerce, art. L441-10'

/** Why terms cannot be saved (French), empty when they can. */
export function paymentTermsErrors(terms: PaymentTerms): string[] {
  if (!Number.isInteger(terms.days) || terms.days < 0) return ['Le délai de paiement est un nombre entier de jours, 0 ou plus.']
  if (terms.endOfMonth && terms.days > MAX_END_OF_MONTH_DAYS) {
    return [`Un délai fin de mois ne peut dépasser ${MAX_END_OF_MONTH_DAYS} jours (${LEGAL_SOURCE}).`]
  }
  if (!terms.endOfMonth && terms.days > MAX_PAYMENT_DAYS) {
    return [`Le délai de paiement ne peut dépasser ${MAX_PAYMENT_DAYS} jours à compter de la date de la facture (${LEGAL_SOURCE}).`]
  }
  return []
}

/** The terms within the legal caps (a value stored before a cap, or typed by an assistant). */
export function capPaymentTerms(terms: PaymentTerms): PaymentTerms {
  const days = Number.isFinite(terms.days) ? Math.max(0, Math.floor(terms.days)) : DEFAULT_PAYMENT_TERMS.days
  return { days: Math.min(days, terms.endOfMonth ? MAX_END_OF_MONTH_DAYS : MAX_PAYMENT_DAYS), endOfMonth: terms.endOfMonth }
}

/** "30 jours", "45 jours fin de mois". */
export function describePaymentTerms(terms: PaymentTerms): string {
  const capped = capPaymentTerms(terms)
  return `${capped.days} jour${capped.days > 1 ? 's' : ''}${capped.endOfMonth ? ' fin de mois' : ''}`
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(iso: string): [number, number, number] {
  const m = ISO.exec(iso)
  if (!m) throw new RangeError(`Invalid ISO date: ${iso}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Due date (yyyy-mm-dd) of an invoice dated `invoiceDay` under `terms`, capped by L441-10. */
export function dueDateOf(invoiceDay: string, terms: PaymentTerms): string {
  const { days, endOfMonth } = capPaymentTerms(terms)
  const [y, m, d] = parts(invoiceDay)
  const due = new Date(Date.UTC(y, m - 1, d + days))
  if (!endOfMonth) return iso(due)
  return iso(new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)))
}

/** Days from `from` to `to` (yyyy-mm-dd): positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}
