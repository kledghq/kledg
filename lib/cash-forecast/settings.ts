/**
 * Settings of the cash forecast (Company.cashForecastSettings, JSON): the
 * minimum cash threshold, the horizon and the flows counted. Pure (zod and
 * the money bounds only): the API, the MCP tools and the settings form read
 * the same schema.
 *
 * Invariant: a stored value that cannot be read (an older or newer shape, a
 * hand edit) never breaks the forecast nor the alert: each field falls back
 * to its default (no threshold, six months, the known flows).
 */

import { z } from 'zod'
import { MAX_AMOUNT_CENTS } from '@/lib/utils/money'
import { CASH_FORECAST_COMPONENTS, DEFAULT_COMPONENTS, normalizeComponents, type CashForecastComponent } from './components'

/** Months the projection covers, from tomorrow. */
export const CASH_FORECAST_HORIZONS = [3, 6, 12] as const
export type CashForecastHorizon = (typeof CASH_FORECAST_HORIZONS)[number]
export const DEFAULT_HORIZON: CashForecastHorizon = 6

export const horizonField = z.union([z.literal(3), z.literal(6), z.literal(12)], { error: 'L’horizon est de 3, 6 ou 12 mois' })

export const CashForecastSettingsSchema = z.object({
  /**
   * Minimum cash the company wants to keep, in cents; null: no alert. May be
   * zero (warn before an overdraft) or negative (an authorised overdraft).
   */
  thresholdCents: z
    .number({ error: 'Le seuil est un montant en centimes' })
    .int({ error: 'Le seuil est un montant en centimes entiers' })
    .min(-MAX_AMOUNT_CENTS, { error: 'Seuil trop élevé' })
    .max(MAX_AMOUNT_CENTS, { error: 'Seuil trop élevé' })
    .nullable(),
  horizonMonths: horizonField,
  /** The flows the projection and the alert count (the page can switch them for a look without saving). */
  components: z
    .array(z.enum(CASH_FORECAST_COMPONENTS, { error: 'Composante de la prévision inconnue' }))
    .max(CASH_FORECAST_COMPONENTS.length)
    .transform((values) => normalizeComponents(values)),
})

export type CashForecastSettings = z.infer<typeof CashForecastSettingsSchema>

export const DEFAULT_CASH_FORECAST_SETTINGS: CashForecastSettings = {
  thresholdCents: null,
  horizonMonths: DEFAULT_HORIZON,
  components: [...DEFAULT_COMPONENTS],
}

/** Body of PUT /api/companies/[id]/cash-forecast-settings: the whole settings object. */
export const CashForecastSettingsBody = CashForecastSettingsSchema

/** The stored JSON read leniently: each valid field kept, every other field at its default. */
export function parseCashForecastSettings(json: unknown): CashForecastSettings {
  const result: CashForecastSettings = { ...DEFAULT_CASH_FORECAST_SETTINGS, components: [...DEFAULT_CASH_FORECAST_SETTINGS.components] }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return result
  const record = json as Record<string, unknown>
  for (const key of Object.keys(CashForecastSettingsSchema.shape) as Array<keyof CashForecastSettings>) {
    const parsed = CashForecastSettingsSchema.shape[key].safeParse(record[key])
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data
  }
  return result
}

export type { CashForecastComponent }
