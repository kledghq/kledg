/**
 * The last company the user opened, remembered in a cookie so the settings
 * area can offer "Retour à <société>". Pure module: the browser writes the
 * cookie (company sidebar), the settings layout reads it on the server and
 * checks access before showing the company's name.
 */

export const LAST_COMPANY_COOKIE = 'kledg_last_company'

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

/** Slugs are lowercase words separated by hyphens; anything else is ignored. */
export function parseLastCompany(value: string | undefined | null): string | null {
  if (!value) return null
  return /^[a-z0-9-]{1,80}$/.test(value) ? value : null
}

/** `document.cookie` assignment that remembers `slug`. */
export function lastCompanyCookie(slug: string): string {
  return `${LAST_COMPANY_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
}
