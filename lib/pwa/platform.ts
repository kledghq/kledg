/**
 * Decisions of the installable app on plain values (no browser globals), so
 * the client components stay thin and the rules are tested
 * (lib/pwa/__tests__/platform.test.ts). Pure: usable on both sides.
 */

import { SERVICE_WORKER_PATH } from './paths'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export type ServiceWorkerDecision = 'register' | 'unregister' | 'skip'

/**
 * Whether the page registers the service worker. Only production builds
 * (a worker in development would serve stale chunks to hot reload), only
 * on a secure origin (HTTPS, or localhost where browsers allow workers).
 * NEXT_PUBLIC_DISABLE_SW=true is the kill switch: the page unregisters
 * any worker already installed and deletes its caches.
 */
export function serviceWorkerDecision(input: {
  nodeEnv: string | undefined
  disabled: string | undefined
  protocol: string
  hostname: string
}): ServiceWorkerDecision {
  if (input.disabled === 'true') return 'unregister'
  if (input.nodeEnv !== 'production') return 'skip'
  if (input.protocol === 'https:') return 'register'
  if (input.protocol === 'http:' && LOCAL_HOSTS.has(input.hostname)) return 'register'
  return 'skip'
}

/** Script URL of the worker for a build: a new build installs a new worker with its own caches (public/sw.js). */
export function serviceWorkerUrl(build: string | undefined): string {
  return build ? `${SERVICE_WORKER_PATH}?v=${encodeURIComponent(build)}` : SERVICE_WORKER_PATH
}

/**
 * iPhone, iPod or iPad. iPadOS reports itself as a Mac: a "Macintosh" with
 * a touch screen is an iPad. Safari on iOS has no install prompt event, so
 * the help menu explains the Share menu instead.
 */
export function isIosDevice(input: { userAgent: string; maxTouchPoints: number }): boolean {
  if (/iPad|iPhone|iPod/.test(input.userAgent)) return true
  return /Macintosh/.test(input.userAgent) && input.maxTouchPoints > 1
}

/** Whether the app already runs installed (standalone window, or the iOS home screen). */
export function isStandaloneDisplay(input: { displayModeStandalone: boolean; navigatorStandalone: boolean | undefined }): boolean {
  return input.displayModeStandalone || input.navigatorStandalone === true
}

/** Prefix of every Cache Storage cache the worker creates (public/sw.js). */
export const PWA_CACHE_PREFIX = 'kledg-'
