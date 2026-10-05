/**
 * Acomptes of the impôt sur les sociétés (relevés 2571-SD) of the fiscal
 * year that follows a worksheet, and the balance (relevé de solde 2572-SD)
 * of the worksheet's own year. Pure.
 *
 * Rules (CGI art. 1668; BOI-IS-DECLA-20-10):
 * - each acompte is a quarter of the IS of the reference profit, the profit
 *   of the last exercice whose return was due, "rapporté à une période de
 *   douze mois", taxed at the rates of art. 219, I (15 % up to 42 500 €
 *   when the company had the reduced rate, 25 % above), rounded to the
 *   euro (§ 60 and 110);
 * - the first acompte falls before the return of the last exercice is due:
 *   it is computed on the exercice before (§ 120 to 130) and regularised
 *   with the second, which brings the first two to half of the IS of the
 *   last exercice. A new company (the year after its first exercice) does
 *   not pay that first acompte and regularises on the second
 *   (BOI-IS-DECLA-20-30);
 * - no acompte when the IS of the reference profit does not exceed 3 000 €,
 *   judged at each due date (§ 360 and 370);
 * - an exercice pays as many acomptes as it holds quarterly dates (the
 *   dates come from the deadline calendar, lib/deadlines/engine.ts).
 * Not covered: the fifth acompte of companies with a chiffre d'affaires
 * above 250 M€, the acomptes of the contribution sociale (art. 1668 D),
 * the modulation of the last acompte by the company.
 */

import { ACOMPTE_EXEMPTION_CENTS, annualize, mulDivRound, REDUCED_RATE_PROFIT_CEILING_CENTS, roundToEuro, taxAtRates, type FiscalYearDuration } from './rules'

/** What an exercice says for the acomptes it is the reference of. */
export interface AcompteReference {
  /** "exercice 2026". */
  label: string
  /** Taxable profit after deficits, for the year (not annualized). */
  profitCents: number
  duration: FiscalYearDuration
  reducedRate: boolean
  /** Figures of a filed return (true) or of the worksheet (false). */
  filed: boolean
}

/** IS of a reference profit brought to twelve months (BOI-IS-DECLA-20-10 § 60). */
export function referenceTax(reference: AcompteReference): number {
  const annual = annualize(Math.max(reference.profitCents, 0), reference.duration)
  return taxAtRates(annual, reference.reducedRate, REDUCED_RATE_PROFIT_CEILING_CENTS).taxCents
}

/** A quarter of an IS, rounded to the euro (§ 110). */
export function quarterOf(taxCents: number): number {
  return roundToEuro(mulDivRound(taxCents, 1, 4))
}

export interface AcompteDue {
  number: number
  /** Due day after the postponement of a weekend or holiday. */
  date: string
  legalDate: string
  /** Id of the deadline in the calendar (lib/deadlines). */
  deadlineId: string
}

export interface ScheduledAcompte extends AcompteDue {
  /** Null when the reference is unknown (the previous return not recorded). */
  amountCents: number | null
  reference: 'current' | 'previous' | 'none'
  exempt: boolean
  note: string
}

export interface AcompteSchedule {
  /** IS of the worksheet's year brought to twelve months: the reference of the acomptes. */
  referenceTaxCents: number
  /** The worksheet's IS does not exceed 3 000 €: no acompte on it. */
  exempt: boolean
  items: ScheduledAcompte[]
  /** Sum of the known amounts. */
  totalCents: number
}

export interface ScheduleInput {
  dues: AcompteDue[]
  /** The worksheet's year. */
  current: AcompteReference
  /** The year before it: a reference, 'none' when there is no such exercice, null when it is not known. */
  previous: AcompteReference | 'none' | null
  /** The first due date falls before the return of the worksheet's year is due. */
  firstOnPrevious: boolean
}

const exemptTax = (taxCents: number) => taxCents <= ACOMPTE_EXEMPTION_CENTS

export function scheduleAcomptes(input: ScheduleInput): AcompteSchedule {
  const referenceTaxCents = referenceTax(input.current)
  const exempt = exemptTax(referenceTaxCents)
  const quarter = exempt ? 0 : quarterOf(referenceTaxCents)
  const items: ScheduledAcompte[] = []
  // What the first acompte paid beyond its definitive amount, imputed on the next ones.
  let carry = 0
  let firstPaid: number | null = null
  const regularise = input.firstOnPrevious && input.dues.length > 1

  input.dues.forEach((due, index) => {
    if (index === 0 && input.firstOnPrevious) {
      const previous = input.previous
      if (previous === 'none') {
        firstPaid = 0
        items.push({ ...due, amountCents: 0, reference: 'none', exempt: false, note: 'Pas d’exercice de référence à cette date : rien à verser, le deuxième acompte régularise.' })
        return
      }
      if (previous === null) {
        items.push({ ...due, amountCents: null, reference: 'previous', exempt: false, note: 'Calculé sur l’exercice précédent, dont le dépôt n’est pas enregistré dans Kledg : un quart de son impôt, sans acompte s’il ne dépassait pas 3 000 €.' })
        return
      }
      const tax = referenceTax(previous)
      const amount = exemptTax(tax) ? 0 : quarterOf(tax)
      firstPaid = amount
      items.push({
        ...due,
        amountCents: amount,
        reference: 'previous',
        exempt: exemptTax(tax),
        note: exemptTax(tax)
          ? `Impôt de référence de l’${previous.label} inférieur ou égal à 3 000 € : pas d’acompte.`
          : `Un quart de l’impôt de l’${previous.label}, la déclaration de l’exercice suivant n’étant pas encore due.`,
      })
      return
    }
    if (index === 1 && regularise) {
      if (firstPaid === null) {
        items.push({ ...due, amountCents: null, reference: 'current', exempt, note: 'La moitié de l’impôt de référence, moins le premier acompte versé.' })
        return
      }
      const definitive = 2 * quarter
      const amount = Math.max(definitive - firstPaid, 0)
      carry = Math.max(firstPaid - definitive, 0)
      items.push({
        ...due,
        amountCents: amount,
        reference: 'current',
        exempt,
        note: exempt
          ? 'Impôt de référence inférieur ou égal à 3 000 € : pas d’acompte.'
          : `Régularisation : la moitié de l’impôt de référence (${(definitive / 100).toLocaleString('fr-FR')} €), moins le premier acompte.`,
      })
      return
    }
    const amount = Math.max(quarter - carry, 0)
    carry = Math.max(carry - quarter, 0)
    items.push({
      ...due,
      amountCents: amount,
      reference: 'current',
      exempt,
      note: exempt ? 'Impôt de référence inférieur ou égal à 3 000 € : pas d’acompte.' : 'Un quart de l’impôt de référence.',
    })
  })

  return { referenceTaxCents, exempt, items, totalCents: items.reduce((s, i) => s + (i.amountCents ?? 0), 0) }
}

export interface AcomptePaid {
  number: number
  paidOn: string
  amountCents: number
}

/** The relevé de solde (2572-SD): the tax of the year less the acomptes paid; negative, an excess to claim back. */
export function balanceOf(totalCents: number, paid: readonly AcomptePaid[]): { paidCents: number; balanceCents: number } {
  const paidCents = paid.reduce((s, p) => s + p.amountCents, 0)
  return { paidCents, balanceCents: totalCents - paidCents }
}
