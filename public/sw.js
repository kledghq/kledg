/**
 * Kledg service worker. Its only jobs: show an offline page instead of the
 * browser error when the network is gone, and keep the hashed build assets
 * (/_next/static) so the app shell loads fast. It never stores anything that
 * holds accounting data or depends on who is signed in:
 *
 * - API calls (/api/*), authenticated HTML pages, React Server Component
 *   payloads, images resized on demand, cross-origin and non-GET requests
 *   are never cached: the browser fetches them as if there were no worker.
 * - The offline page, the logo and the icons are precached at install and
 *   served from that cache.
 * - Navigations go to the network; when it fails, the precached offline page
 *   answers (the page itself is never stored).
 * - Only same-origin GET requests under /_next/static/ (file names carry a
 *   content hash, so they never change) are cached, cache first.
 * - Files shared to Kledg from another app (the share target of
 *   app/manifest.ts: a photo of a receipt, a PDF invoice) arrive as a POST
 *   to /share. The worker answers it itself: the files are kept in the
 *   share cache, on this device only, and the browser goes to the /share
 *   page, which asks for the company, sends them to Kledg and empties the
 *   cache. A new share replaces the files of the previous one. Nothing
 *   reaches the server before the user picks the company, signed in: no
 *   other site can post files into Kledg this way.
 *
 * The routing decision is the pure function `routeRequest`, tested in
 * lib/pwa/__tests__/sw.test.ts. The page registers this worker as
 * /sw.js?v=<build> (components/pwa/pwa-provider.tsx): each build installs a
 * new worker with its own cache names, and activate deletes the caches of
 * older builds. Served with its own CSP (lib/security-headers.ts).
 */

const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE_PREFIX = 'kledg-'
const SHELL_CACHE = `${CACHE_PREFIX}shell-${BUILD}`
const STATIC_CACHE = `${CACHE_PREFIX}static-${BUILD}`
const OFFLINE_URL = '/offline.html'
/** Public, static files of the offline page and the install icons. */
const PRECACHE_URLS = [OFFLINE_URL, '/logo.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png']
/** Upper bound of the static cache within one build (lazy chunks of every page visited). */
const STATIC_CACHE_MAX_ENTRIES = 300
/** Files shared to Kledg, kept across builds until the /share page takes them (components/features/receipts/shared-files.ts). */
const SHARE_CACHE = `${CACHE_PREFIX}share`
const SHARE_PATH = '/share'
/** At most this many files per share, each at most this size (a photo is then reduced in the page). */
const SHARE_MAX_FILES = 10
const SHARE_MAX_BYTES = 25 * 1024 * 1024

/**
 * What the worker does with a request: 'static' (cache first), 'shell'
 * (the precached public files, from the cache, so the offline page shows
 * its logo), 'navigation' (network, offline page on failure), 'share' (files
 * shared from another app, kept for the /share page) or 'bypass' (the worker
 * does not answer, the browser fetches normally and nothing is stored).
 * Pure: takes plain values so it can be tested without a browser.
 *
 * @param {{ url: string, method: string, mode: string, origin: string }} request
 * @returns {'static' | 'shell' | 'navigation' | 'share' | 'bypass'}
 */
function routeRequest(request) {
  let url
  try {
    url = new URL(request.url)
  } catch {
    return 'bypass'
  }
  if (url.origin !== request.origin) return 'bypass'
  const path = url.pathname
  if (request.method === 'POST' && path === SHARE_PATH) return 'share'
  if (request.method !== 'GET') return 'bypass'
  // Accounting data and authenticated answers: never touched.
  if (path === '/api' || path.startsWith('/api/')) return 'bypass'
  if (request.mode === 'navigate') return 'navigation'
  if (PRECACHE_URLS.includes(path) && !url.search) return 'shell'
  // Hashed build assets only (not /_next/image, /_next/data or RSC payloads).
  if (path.startsWith('/_next/static/') && !url.searchParams.has('_rsc')) return 'static'
  return 'bypass'
}

/** Keeps the newest entries of a cache (insertion order) under `max`. */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key)
}

async function staticFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  // Only complete, same-origin answers (no opaque or partial responses).
  if (response.ok && response.status === 200 && response.type === 'basic') {
    await cache.put(request, response.clone())
    await trimCache(STATIC_CACHE, STATIC_CACHE_MAX_ENTRIES)
  }
  return response
}

async function shellFirst(request) {
  const cached = await caches.match(new URL(request.url).pathname, { cacheName: SHELL_CACHE })
  return cached || fetch(request)
}

async function networkWithOfflineFallback(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE })
    return offline || Response.error()
  }
}

/**
 * The files of a share (form field "files"), kept in the share cache as
 * /share/file/<n> with their type and name, then the browser goes to the
 * /share page. Anything else in the form (a title, a text, a link) is ignored.
 */
async function receiveShare(request) {
  try {
    const form = await request.formData()
    const files = form.getAll('files').filter((value) => typeof value === 'object' && value !== null && typeof value.arrayBuffer === 'function')
    const cache = await caches.open(SHARE_CACHE)
    for (const key of await cache.keys()) await cache.delete(key)
    let kept = 0
    for (const file of files.slice(0, SHARE_MAX_FILES)) {
      if (file.size === 0 || file.size > SHARE_MAX_BYTES) continue
      const headers = { 'Content-Type': file.type || 'application/octet-stream', 'X-Kledg-File-Name': encodeURIComponent(file.name || 'justificatif') }
      await cache.put(new Request(`${SHARE_PATH}/file/${kept}`), new Response(file, { headers }))
      kept++
    }
    return Response.redirect(new URL(`${SHARE_PATH}?files=${kept}${files.length > kept ? `&skipped=${files.length - kept}` : ''}`, self.location.origin).href, 303)
  } catch {
    return Response.redirect(new URL(`${SHARE_PATH}?error=1`, self.location.origin).href, 303)
  }
}

self.addEventListener('install', (event) => {
  // Waits for the page to ask (SKIP_WAITING) before taking over, so a tab
  // never runs with assets of two builds: the page shows "Nouvelle version
  // disponible" and reloads on demand.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The share cache outlives builds: files shared just before an update stay until the page takes them
      const keep = new Set([SHELL_CACHE, STATIC_CACHE, SHARE_CACHE])
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name)).map((name) => caches.delete(name)))
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const route = routeRequest({ url: request.url, method: request.method, mode: request.mode, origin: self.location.origin })
  if (route === 'static') event.respondWith(staticFirst(request))
  else if (route === 'shell') event.respondWith(shellFirst(request))
  else if (route === 'navigation') event.respondWith(networkWithOfflineFallback(event))
  else if (route === 'share') event.respondWith(receiveShare(request))
  // 'bypass': no respondWith, the browser handles the request itself.
})

// Read by the test harness (lib/pwa/__tests__/sw.test.ts); harmless in the worker.
self.__kledgSw = { routeRequest, receiveShare, SHELL_CACHE, STATIC_CACHE, SHARE_CACHE, PRECACHE_URLS, OFFLINE_URL }
