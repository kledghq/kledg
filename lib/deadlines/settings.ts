/**
 * Settings of the deadline calendar: what a deadline depends on and Kledg
 * does not hold (Company.deadlineSettings, JSON). Pure (zod only): the API,
 * the settings card and the engine read the same schema.
 *
 * Invariant: a stored value that cannot be read (an older or newer shape, a
 * hand edit) never breaks the calendar: each field falls back to its
 * default, which is the cautious choice (show the deadline, take the
 * earliest day, the shorter delay).
 */

import { z } from 'zod'

/**
 * Days of the month the administration assigns for the CA3 and the CA12
 * acomptes of a company: from the 15th to the 24th of the following month,
 * by legal form, location (Paris and Ile-de-France or not) and SIREN (CGI,
 * annexe IV, art. 39; BOI-TVA-DECLA-20-20-10-10 §200). The impots.gouv.fr
 * professional space shows the company's own day.
 *
 * Sources:
 * - https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000030190488
 * - https://bofip.impots.gouv.fr/bofip/1001-PGP.html/identifiant=BOI-TVA-DECLA-20-20-10-10-20230118
 */
export const VAT_FILING_DAY_MIN = 15
export const VAT_FILING_DAY_MAX = 24

/**
 * The earliest day the grid of art. 39 gives a company of this legal form,
 * so the default is never later than the company's real day:
 * - sole traders (EI): the 15th (Paris and Ile-de-France, names A to H);
 * - SA: the 23rd (Paris and Ile-de-France, SIREN 00 to 74);
 * - other companies: the 19th (Paris and Ile-de-France, SIREN 00 to 68);
 * - legal form unknown: the 15th, the earliest day of the grid.
 */
export function defaultVatFilingDay(legalType: string | null | undefined): number {
  if (!legalType) return VAT_FILING_DAY_MIN
  if (legalType === 'EI') return 15
  if (legalType === 'SA') return 23
  return 19
}

/** CA3 frequency: "auto" is monthly at the réel normal, quarterly for a former réel simplifié from 2027. */
export const VAT_CA3_FREQUENCIES = ['auto', 'monthly', 'quarterly'] as const
export type VatCa3Frequency = (typeof VAT_CA3_FREQUENCIES)[number]

export const DeadlineSettingsSchema = z.object({
  /** Day of the month of the CA3 and of the CA12 acomptes; null: not known, the earliest day of the legal form is shown. */
  vatFilingDay: z
    .number({ error: 'Le jour de déclaration est un nombre entre 15 et 24' })
    .int()
    .min(VAT_FILING_DAY_MIN, { error: 'Le jour de déclaration de TVA est compris entre le 15 et le 24' })
    .max(VAT_FILING_DAY_MAX, { error: 'Le jour de déclaration de TVA est compris entre le 15 et le 24' })
    .nullable(),
  /** Quarterly CA3 when the annual VAT is under 4 000 € (CGI, art. 287, 2), monthly on request. */
  vatCa3Frequency: z.enum(VAT_CA3_FREQUENCIES, { error: 'Fréquence de déclaration de TVA inconnue' }),
  /** Réel simplifié: the July and December acomptes are due (not when last year's VAT was under 1 000 €). */
  vatSimplifiedAcomptes: z.boolean(),
  /** IS acomptes are due (not when the IS of the reference year is 3 000 € or less). */
  isAcomptes: z.boolean(),
  /** CFE acompte of 15 June (when the previous year's CFE reached 3 000 €). */
  cfeAcompte: z.boolean(),
  /** The company paid fees of more than 2 400 € to one beneficiary in the year (DAS2, BOI-BIC-DECLA-30-70-20 §140). */
  das2: z.boolean(),
  /** Turnover above 152 500 € excluding tax: the 1330-CVAE is due. */
  cvae: z.boolean(),
  /** Annual accounts filed online with the greffe: two months instead of one after approval. */
  accountsFiledOnline: z.boolean(),
})

export type DeadlineSettings = z.infer<typeof DeadlineSettingsSchema>

export const DEFAULT_DEADLINE_SETTINGS: DeadlineSettings = {
  vatFilingDay: null,
  vatCa3Frequency: 'auto',
  vatSimplifiedAcomptes: true,
  isAcomptes: true,
  cfeAcompte: false,
  das2: false,
  cvae: false,
  accountsFiledOnline: false,
}

/** Body of PUT /api/companies/[id]/deadline-settings: the whole settings object. */
export const DeadlineSettingsBody = DeadlineSettingsSchema

/** The stored JSON read leniently: each valid field kept, every other field at its default. */
export function parseDeadlineSettings(json: unknown): DeadlineSettings {
  const result: DeadlineSettings = { ...DEFAULT_DEADLINE_SETTINGS }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return result
  const record = json as Record<string, unknown>
  for (const key of Object.keys(DeadlineSettingsSchema.shape) as Array<keyof DeadlineSettings>) {
    const parsed = DeadlineSettingsSchema.shape[key].safeParse(record[key])
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.data
  }
  return result
}
