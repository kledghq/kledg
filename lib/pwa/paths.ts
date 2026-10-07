/**
 * Public files of the installable app. Pure (no imports): the request proxy
 * imports it.
 *
 * The browser fetches them without a session: the manifest is requested
 * without cookies, the service worker is registered from the login page
 * too, and the offline page is precached by the worker. They hold no data,
 * so the proxy serves them without the sign-in redirect and without the
 * page CSP (lib/security-headers.ts gives each its own policy).
 * Images (icons, apple-icon.png, logo.svg) are outside the proxy matcher.
 */

export const SERVICE_WORKER_PATH = '/sw.js'
const OFFLINE_PAGE_PATH = '/offline.html'
const MANIFEST_PATH = '/manifest.webmanifest'

const PWA_PUBLIC_PATHS = new Set([SERVICE_WORKER_PATH, OFFLINE_PAGE_PATH, MANIFEST_PATH])

/** Whether `pathname` is one of the public files of the installable app. */
export function isPwaPublicPath(pathname: string): boolean {
  return PWA_PUBLIC_PATHS.has(pathname)
}

/**
 * Background of the app in each theme (app/globals.css --background): the
 * manifest's colors and the theme-color of app/layout.tsx (browser bars,
 * splash screen).
 */
export const THEME_COLORS = { light: '#ffffff', dark: '#0a0a0a' } as const
