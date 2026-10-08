/**
 * Validation of chart colour preferences. Pure (zod only): the API validates
 * bodies and stored rows with it, the settings page its hex fields.
 *
 * Strict on input: `#rrggbb` colours only, known presets and series only,
 * nothing else in the object, and a small body (MAX_APPEARANCE_BODY_BYTES).
 * A stored row that no longer parses (written by another version) reads as
 * the default, never as an error: the charts always render.
 */

import { z } from 'zod'
import {
  CHART_PALETTES,
  CHART_PRESETS,
  CHART_SERIES,
  DEFAULT_APPEARANCE,
  HEX_COLOR,
  type AppearancePreferences,
  type ChartColorOverrides,
  type ChartSeries,
} from './palette'

/** Version of the stored JSON (UserPreference.appearance). */
const APPEARANCE_VERSION = 1

/** Far above a full custom palette (about 700 bytes), far below the default 1 MB of JSON routes. */
export const MAX_APPEARANCE_BODY_BYTES = 4096

const HexColorField = z
  .string({ error: 'Couleur attendue au format #rrggbb' })
  .regex(HEX_COLOR, { error: 'Couleur attendue au format #rrggbb, par exemple #1c7f55' })
  .transform((value) => value.toLowerCase())

const seriesShape = Object.fromEntries(CHART_SERIES.map((series) => [series, HexColorField.optional()])) as Record<
  ChartSeries,
  z.ZodOptional<typeof HexColorField>
>

/** The colours of one theme: known series only (an unknown key is refused). */
const ColorOverridesSchema = z.strictObject(seriesShape, { error: 'Série de graphique inconnue' })

/** Body of PUT /api/account/appearance. */
export const AppearanceBody = z.strictObject({
  palette: z.enum(CHART_PALETTES, { error: 'Palette inconnue : sobre, contraste, daltonisme, pastel ou custom' }),
  base: z.enum(CHART_PRESETS, { error: 'Palette de départ inconnue : sobre, contraste, daltonisme ou pastel' }).default('sobre'),
  custom: z
    .strictObject({ light: ColorOverridesSchema.default({}), dark: ColorOverridesSchema.default({}) })
    .default({ light: {}, dark: {} }),
})
export type AppearanceInput = z.input<typeof AppearanceBody>
export type AppearanceValues = z.output<typeof AppearanceBody>

/** What is stored: the preferences with their format version. */
const StoredAppearanceSchema = AppearanceBody.extend({ version: z.literal(APPEARANCE_VERSION) })

function compact(overrides: Partial<Record<ChartSeries, string | undefined>>): ChartColorOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([, color]) => color !== undefined)) as ChartColorOverrides
}

/** Parsed body to preferences: custom colours kept only for a custom palette (a preset ignores them). */
export function toPreferences(input: AppearanceValues): AppearancePreferences {
  if (input.palette !== 'custom') return { palette: input.palette, base: input.palette, custom: { light: {}, dark: {} } }
  return { palette: 'custom', base: input.base, custom: { light: compact(input.custom.light), dark: compact(input.custom.dark) } }
}

/** The JSON stored for these preferences. */
export function toStoredAppearance(prefs: AppearancePreferences) {
  return { version: APPEARANCE_VERSION, palette: prefs.palette, base: prefs.base, custom: prefs.custom }
}

/** A stored row read back: the default when it is missing or no longer valid. */
export function parseStoredAppearance(value: unknown): AppearancePreferences {
  const parsed = StoredAppearanceSchema.safeParse(value)
  return parsed.success ? toPreferences(parsed.data) : DEFAULT_APPEARANCE
}
