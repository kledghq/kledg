/**
 * Settings of the cash forecast (lenient reading, validation with French
 * messages) and its sentences: an alert says when, how much and that it is
 * a projection; the simple mode words carry no accounting jargon
 * (SIMPLE_MODE_JARGON, docs/mode-simple.md).
 */

import { describe, expect, it } from 'vitest'
import { CashForecastSettingsSchema, DEFAULT_CASH_FORECAST_SETTINGS, parseCashForecastSettings } from '../settings'
import { COMPONENT_INFO, CASH_FORECAST_COMPONENTS, overlapsTrend } from '../components'
import { ALERT_TITLES, FORECAST_DESCRIPTIONS, FORECAST_TITLES, NOT_A_GUARANTEE, aboveThresholdSentence, alertSentence, periodLabel, periodShortLabel } from '../wording'
import { alertOf } from '../alert'
import { projectCashForecast } from '../projection'
import { jargonIn } from '@/lib/simple/vocabulary'
import { formatCentsFr } from '@/lib/utils/money'

describe('cash forecast settings', () => {
  it('reads the defaults when nothing or garbage is stored, field by field otherwise', () => {
    expect(parseCashForecastSettings(null)).toEqual(DEFAULT_CASH_FORECAST_SETTINGS)
    expect(DEFAULT_CASH_FORECAST_SETTINGS).toEqual({ thresholdCents: null, horizonMonths: 6, components: ['receivables', 'payables', 'taxes', 'recurring'] })
    expect(parseCashForecastSettings({ thresholdCents: 500_000, horizonMonths: 7, components: ['trend', 'nope'] })).toEqual({
      thresholdCents: 500_000,
      horizonMonths: 6,
      components: ['receivables', 'payables', 'taxes', 'recurring'],
    })
    expect(parseCashForecastSettings({ components: ['trend', 'receivables', 'trend'] }).components).toEqual(['receivables', 'trend'])
  })

  it('refuses a horizon, a threshold or a component it does not know, in French', () => {
    const result = CashForecastSettingsSchema.safeParse({ thresholdCents: 12.5, horizonMonths: 4, components: ['salaires'] })
    expect(result.success).toBe(false)
    const messages = result.error!.issues.map((i) => i.message)
    expect(messages).toContain('Le seuil est un montant en centimes entiers')
    expect(messages).toContain('L’horizon est de 3, 6 ou 12 mois')
    expect(messages).toContain('Composante de la prévision inconnue')
  })

  it('warns that the recent pace overlaps the recurring payments and the budget', () => {
    expect(overlapsTrend(['trend'])).toBe(false)
    expect(overlapsTrend(['trend', 'recurring'])).toBe(true)
    expect(overlapsTrend(['budget', 'recurring'])).toBe(false)
  })
})

describe('cash forecast wording', () => {
  const projection = projectCashForecast({
    today: '2026-10-05',
    horizonMonths: 6,
    granularity: 'month',
    openingCents: 800_000,
    items: [
      { component: 'taxes', label: 'TVA', day: '2026-11-19', amountCents: -600_000 },
      { component: 'payables', label: 'Imprimerie', day: '2026-11-25', amountCents: -100_000 },
    ],
    components: ['taxes', 'payables'],
    thresholdCents: 500_000,
  })
  const alert = alertOf({ projection })!

  it('says when the balance crosses the threshold, its lowest point, in both modes', () => {
    expect(alert).toEqual({ thresholdCents: 500_000, horizonMonths: 6, day: '2026-11-19', balanceCents: 200_000, already: false, lowest: { day: '2026-11-25', cents: 100_000 } })
    expect(alertSentence(alert, 'expert')).toBe(
      'D’après la prévision, le solde passe sous le seuil de 5 000,00 € le 19 novembre 2026 (2 000,00 €). Point le plus bas : 1 000,00 € le 25 novembre 2026.',
    )
    expect(alertSentence(alert, 'simple')).toBe(
      'Votre compte risque de passer sous 5 000,00 € le 19 novembre 2026 : il resterait 2 000,00 €. Au plus bas, il resterait 1 000,00 € le 25 novembre 2026.',
    )
    expect(alertSentence({ ...alert, already: true, balanceCents: 300_000 }, 'simple')).toBe(
      'Votre compte est déjà sous 5 000,00 €, le minimum que vous voulez garder : il reste 3 000,00 €.',
    )
    expect(aboveThresholdSentence(500_000, 6, 'expert', formatCentsFr)).toBe('Le solde projeté reste au-dessus du seuil de 5 000,00 € sur les 6 prochains mois.')
  })

  it('labels periods for tables and axes', () => {
    expect(periodLabel({ period: '2026-11', start: '2026-11-01' }, 'month')).toBe('Novembre 2026')
    expect(periodLabel({ period: '2026-10-05', start: '2026-10-06' }, 'week')).toBe('Semaine du 5 octobre 2026')
    expect(periodShortLabel({ period: '2026-11' }, 'month')).toBe('nov. 26')
    expect(periodShortLabel({ period: '2026-10-05' }, 'week')).toBe('5 oct.')
  })

  it('keeps the simple mode free of accounting jargon and account numbers', () => {
    const simple = [
      FORECAST_TITLES.simple,
      FORECAST_DESCRIPTIONS.simple,
      NOT_A_GUARANTEE.simple,
      ALERT_TITLES.simple,
      alertSentence(alert, 'simple'),
      alertSentence({ ...alert, already: true }, 'simple'),
      aboveThresholdSentence(500_000, 6, 'simple'),
      ...CASH_FORECAST_COMPONENTS.flatMap((c) => [COMPONENT_INFO[c].simpleLabel, COMPONENT_INFO[c].simpleDescription, COMPONENT_INFO[c].simpleEmpty]),
    ]
    expect(simple.flatMap(jargonIn)).toEqual([])
    // The expert words do name the accounts: the test would catch a simple text copied from them.
    expect(jargonIn(COMPONENT_INFO.receivables.description + ' compte 512')).not.toEqual([])
  })

  it('says it is a projection, not a guarantee', () => {
    expect(NOT_A_GUARANTEE.expert).toMatch(/sans garantie/)
    expect(NOT_A_GUARANTEE.simple).toMatch(/pas une certitude/)
  })
})
