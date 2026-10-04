import { ALL_CHART_THEME_VARIABLES, chartStyleVariables, type AppearancePreferences } from '@/lib/appearance/palette'

/**
 * Applies saved chart colours to the open page at once: the same variables
 * the root layout renders on <html> (lib/appearance/palette.ts), so every
 * chart switches without a reload. The next server render sets the same
 * values.
 */
export function applyChartColors(prefs: AppearancePreferences, root: HTMLElement = document.documentElement): void {
  for (const name of ALL_CHART_THEME_VARIABLES) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(chartStyleVariables(prefs))) root.style.setProperty(name, value)
}
