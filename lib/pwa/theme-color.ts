import { THEME_COLORS } from './paths'

/**
 * The browser bar color (meta theme-color) for the theme chosen in the app.
 *
 * app/layout.tsx renders one theme-color per color scheme
 * (`media="(prefers-color-scheme: dark)"`), which follows the system only.
 * When the user picks Clair or Sombre in the header, every tag takes that
 * theme's color, so the bar matches the page whatever the system says; with
 * Système (or before the choice is known) each tag keeps the color of its
 * own media query. Pure: unit tested, used by components/pwa/theme-color-sync.
 */
export function themeColorFor(theme: string | undefined, media: string | null): string {
  if (theme === 'light' || theme === 'dark') return THEME_COLORS[theme]
  return media && /prefers-color-scheme:\s*dark/.test(media) ? THEME_COLORS.dark : THEME_COLORS.light
}
