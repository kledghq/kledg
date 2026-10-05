/**
 * Display mode of a user (docs/modes-et-menu.md): "simple" for people who do
 * not know accounting, "standard" for the expert pages with a sidebar of the
 * day-to-day pages only, "expert" for every page. Pure (zod only): the API
 * validates bodies with it, the sidebar switch and the settings page share
 * its labels and paths.
 *
 * The mode is a display preference of the user, not of the company: the
 * same books, shown two ways. It never changes what a role may do.
 */

import { z } from 'zod'

export const DISPLAY_MODES = ['simple', 'standard', 'expert'] as const
export type DisplayMode = (typeof DISPLAY_MODES)[number]

/** What a user who never chose sees: the interface as it always was. */
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'expert'

export const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = { simple: 'Simple', standard: 'Standard', expert: 'Expert' }

/** One line per mode, under its name in the header menu, the onboarding step and Apparence. */
export const DISPLAY_MODE_DESCRIPTIONS: Record<DisplayMode, string> = {
  simple: 'Sans jargon comptable',
  standard: 'Les pages du quotidien',
  expert: 'Toutes les pages',
}

/**
 * The pages, words and home a mode uses. Standard is the expert mode with a
 * shorter sidebar: same pages, same vocabulary, same dashboard. Everything
 * but the sidebar asks this, never `mode === 'expert'`, so Standard never
 * gets a simple page and the simple mode never leaks into it.
 */
export type DisplayVocabulary = 'simple' | 'expert'

export function vocabularyOf(mode: DisplayMode): DisplayVocabulary {
  return mode === 'simple' ? 'simple' : 'expert'
}

/** Body of PUT /api/account/display-mode. */
export const DisplayModeBody = z.strictObject({
  mode: z.enum(DISPLAY_MODES, { error: "Mode d'affichage inconnu : simple, standard ou expert" }),
})
export type DisplayModeInput = z.infer<typeof DisplayModeBody>

/** A stored value read back: null when missing or unknown (then the default applies). */
export function parseDisplayMode(value: unknown): DisplayMode | null {
  return typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value) ? (value as DisplayMode) : null
}

/** Company-relative path of the simple home (app/(company)/[companyId]/simple). */
export const SIMPLE_HOME_PATH = '/simple'

/** Where a company opens in this mode: the simple home, or the dashboard (standard and expert). */
export function companyHomePath(companyRef: string, mode: DisplayMode): string {
  return vocabularyOf(mode) === 'simple' ? `/${companyRef}${SIMPLE_HOME_PATH}` : `/${companyRef}`
}
