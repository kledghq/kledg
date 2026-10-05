/**
 * Sentences of the cash forecast in both display modes
 * (docs/prevision-tresorerie.md, docs/mode-simple.md). Pure: the page, the
 * alert cards, the simple home and the export share them. The simple mode
 * sentences carry no account number nor accounting term (SIMPLE_MODE_JARGON,
 * checked by the tests).
 *
 * Every alert says it is a projection: the figures come from what the books
 * know today, not from a guarantee.
 */

import { formatCentsFr } from '@/lib/utils/money'
import { dateInWords } from '@/lib/simple/vocabulary'
import { monthLabel } from './flows'
import type { ForecastGranularity, ForecastPeriod } from './projection'
import type { CashForecastAlert } from './alert'

export type ForecastMode = 'expert' | 'simple'

export const FORECAST_TITLES: Record<ForecastMode, string> = {
  expert: 'Prévision de trésorerie',
  simple: 'Votre argent dans les prochains mois',
}

export const FORECAST_DESCRIPTIONS: Record<ForecastMode, string> = {
  expert:
    'Solde bancaire projeté à partir du solde du jour et des flux connus : factures ouvertes, échéances fiscales, paiements récurrents, et si vous le choisissez le budget ou le rythme récent.',
  simple: 'Ce qui devrait rester sur votre compte, d’après ce que vous allez encaisser et payer.',
}

/** Shown on the page, the export and the alerts: a projection, not a promise. */
export const NOT_A_GUARANTEE: Record<ForecastMode, string> = {
  expert: 'Projection à partir des données connues aujourd’hui, sans garantie : retards de paiement, dépenses imprévues et opérations non saisies la feront varier.',
  simple: 'C’est une prévision, pas une certitude : un client qui paie en retard ou une dépense imprévue peut tout changer.',
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "Octobre 2026", "Semaine du 5 octobre 2026". */
export function periodLabel(period: Pick<ForecastPeriod, 'period' | 'start'>, granularity: ForecastGranularity): string {
  return granularity === 'month' ? capitalize(monthLabel(period.period)) : `Semaine du ${dateInWords(period.period)}`
}

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** Axis label: "oct. 26", "5 oct.". */
export function periodShortLabel(period: Pick<ForecastPeriod, 'period'>, granularity: ForecastGranularity): string {
  const month = SHORT_MONTHS[Number(period.period.slice(5, 7)) - 1]
  return granularity === 'month' ? `${month} ${period.period.slice(2, 4)}` : `${Number(period.period.slice(8, 10))} ${month}`
}

export const ALERT_TITLES: Record<ForecastMode, string> = {
  expert: 'Trésorerie prévue sous le seuil',
  simple: 'Attention à votre argent dans les prochains mois',
}

/** The alert in one or two sentences. */
export function alertSentence(alert: CashForecastAlert, mode: ForecastMode, format: (cents: number) => string = formatCentsFr): string {
  const threshold = format(alert.thresholdCents)
  if (mode === 'simple') {
    if (alert.already) return `Votre compte est déjà sous ${threshold}, le minimum que vous voulez garder : il reste ${format(alert.balanceCents)}.`
    const lowest = alert.lowest.day === alert.day ? '' : ` Au plus bas, il resterait ${format(alert.lowest.cents)} le ${dateInWords(alert.lowest.day)}.`
    return `Votre compte risque de passer sous ${threshold} le ${dateInWords(alert.day)} : il resterait ${format(alert.balanceCents)}.${lowest}`
  }
  if (alert.already) return `Le solde bancaire du jour (${format(alert.balanceCents)}) est déjà sous le seuil de ${threshold}.`
  const lowest = alert.lowest.day === alert.day ? '' : ` Point le plus bas : ${format(alert.lowest.cents)} le ${dateInWords(alert.lowest.day)}.`
  return `D’après la prévision, le solde passe sous le seuil de ${threshold} le ${dateInWords(alert.day)} (${format(alert.balanceCents)}).${lowest}`
}

/** One line under the curve when it stays above the threshold over the horizon. */
export function aboveThresholdSentence(thresholdCents: number, horizonMonths: number, mode: ForecastMode, format: (cents: number) => string = formatCentsFr): string {
  return mode === 'simple'
    ? `Sur les ${horizonMonths} prochains mois, votre compte devrait rester au-dessus de ${format(thresholdCents)}.`
    : `Le solde projeté reste au-dessus du seuil de ${format(thresholdCents)} sur les ${horizonMonths} prochains mois.`
}

/** Heading of the status card of the dashboard and of the simple home. */
export const STATUS_TITLES: Record<ForecastMode, string> = {
  expert: 'Prévision de trésorerie',
  simple: 'Votre argent à venir',
}

/** The status card when the company has no threshold. */
export const NO_THRESHOLD_SENTENCES: Record<ForecastMode, string> = {
  expert: 'Aucun seuil d’alerte\u00a0: définissez le solde minimum à garder pour être prévenu avant qu’il ne soit franchi.',
  simple: 'Voyez ce qui devrait rester sur votre compte dans les prochains mois, et choisissez le minimum à garder.',
}

/** The status card when the forecast could not be loaded. */
export const STATUS_ERRORS: Record<ForecastMode, string> = {
  expert: 'La prévision de trésorerie n’a pas pu être calculée pour le moment.',
  simple: 'Impossible de calculer votre argent à venir pour le moment.',
}

/** In the list of flows: a late flow counted on the first day of the forecast (tomorrow). */
export const LATE_FLOW: Record<ForecastMode, string> = {
  expert: 'En retard, compté demain',
  simple: 'En retard, compté dès demain',
}

/** Link text of the alert cards. */
export const ALERT_ACTIONS: Record<ForecastMode, string> = {
  expert: 'Voir la prévision',
  simple: 'Voir le détail',
}
