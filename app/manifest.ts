import type { MetadataRoute } from 'next'
import { THEME_COLORS } from '@/lib/pwa/paths'

/**
 * Web app manifest (/manifest.webmanifest): makes Kledg installable from
 * the browser (home screen, dock, start menu). Icons are generated from the
 * K mark by scripts/generate-pwa-icons.mjs. The proxy serves this file
 * without a session (lib/pwa/paths.ts): browsers fetch it without cookies.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Kledg',
    short_name: 'Kledg',
    description: 'Comptabilité open source pour les sociétés françaises, tenue selon le plan comptable général.',
    lang: 'fr',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    categories: ['finance', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
