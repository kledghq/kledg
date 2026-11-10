/**
 * Equity below half the share capital (docs/approbation-des-comptes.md):
 * when the accounts show capitaux propres below half the share capital,
 * the associates decide within four months of the approval of those
 * accounts whether to dissolve the company early, the decision is
 * published, and unless they dissolve, the equity is restored to at least
 * half the capital (or the capital reduced) by the close of the second
 * exercice following the one in which the losses were noted
 * (C. com. art. L223-42 for a SARL or an EURL, L225-248 for a SA, applied
 * to a SAS or a SASU by L227-1). A société civile is not concerned.
 *
 * Capitaux propres are those of the balance sheet (PCG art. 934-1, classes
 * 10 to 14): capital, reserves, report à nouveau, result of the year,
 * investment grants and provisions réglementées.
 *
 * Pure: no database, no clock.
 */

import { addMonthsEom } from '@/lib/deadlines/engine'
import type { ApprovalForm } from './legal-regime'
import { SOURCES, type LegalSource } from './sources'

export interface EquityInput {
  form: ApprovalForm | null
  /** Share capital: the company record, else the credit balance of 101. */
  capitalCents: number | null
  /** Capitaux propres at the close, the result of the year included. */
  equityCents: number
  fiscalYear: { startDate: string; endDate: string }
  /** Day the accounts were approved, when recorded. */
  approvedOn: string | null
}

export interface EquityAlert {
  equityCents: number
  halfCapitalCents: number
  /** Last day to decide on an early dissolution: four months after the approval; null until it is recorded. */
  decisionDeadline: string | null
  /** Close of the second exercice after the one in which the losses are noted (twelve-month exercices assumed). */
  restoreBy: string
  message: string
  sources: LegalSource[]
}

const FORM_SOURCES: Partial<Record<ApprovalForm, LegalSource[]>> = {
  SARL: [SOURCES.L223_42],
  EURL: [SOURCES.L223_42],
  SA: [SOURCES.L225_248],
  SAS: [SOURCES.L225_248, SOURCES.L227_1],
  SASU: [SOURCES.L225_248, SOURCES.L227_1],
}

const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f/g, '\u00a0') + '\u00a0€'

/** The alert when the equity is below half the share capital; null otherwise, or when the rule does not apply or the capital is unknown. */
export function equityBelowHalfCapital(input: EquityInput): EquityAlert | null {
  const sources = input.form ? FORM_SOURCES[input.form] : undefined
  if (!sources || input.capitalCents === null || input.capitalCents <= 0) return null
  // Half the capital, exact: compare twice the equity with the capital
  if (2 * input.equityCents >= input.capitalCents) return null
  const halfCapitalCents = Math.ceil(input.capitalCents / 2)
  const decisionDeadline = input.approvedOn ? addMonthsEom(input.approvedOn, 4) : null
  // The losses are noted when the accounts are approved, during the next exercice: two exercices after that one
  const restoreBy = addMonthsEom(input.fiscalYear.endDate, 36)
  const decision = decisionDeadline
    ? `au plus tard le ${decisionDeadline.split('-').reverse().join('/')}`
    : "dans les quatre mois qui suivent l'approbation des comptes"
  const message =
    `Les capitaux propres (${euros(input.equityCents)}) sont inférieurs à la moitié du capital social (${euros(halfCapitalCents)}). ` +
    `Les associés doivent décider ${decision} s'il y a lieu à dissolution anticipée de la société, et cette décision est publiée. ` +
    `Sans dissolution, les capitaux propres doivent être reconstitués à hauteur de la moitié du capital, ou le capital réduit, ` +
    `au plus tard à la clôture du deuxième exercice suivant (le ${restoreBy.split('-').reverse().join('/')} pour des exercices de douze mois).`
  return { equityCents: input.equityCents, halfCapitalCents, decisionDeadline, restoreBy, message, sources }
}
