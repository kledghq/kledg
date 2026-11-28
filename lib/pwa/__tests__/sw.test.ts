/**
 * The service worker (public/sw.js), run in a small harness: a VM context
 * with fake `self`, `caches` and `fetch`. Checks what is cached and, above
 * all, what never is: API answers, authenticated pages, anything that is not
 * a hashed build asset.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8')
const ORIGIN = 'https://kledg.example'

type Route = 'static' | 'shell' | 'navigation' | 'bypass'
type FakeRequest = { url: string; method: string; mode: string }
type FakeResponse = { ok: boolean; status: number; type: string; body: string; clone(): FakeResponse }
type Listener = (event: unknown) => void

const response = (body: string, status = 200, type = 'basic'): FakeResponse => ({
  ok: status >= 200 && status < 300,
  status,
  type,
  body,
  clone() {
    return response(body, status, type)
  },
})

const keyOf = (request: string | FakeRequest) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).href

class FakeCache {
  entries = new Map<string, FakeResponse>()
  async match(request: string | FakeRequest) {
    return this.entries.get(keyOf(request))
  }
  async put(request: string | FakeRequest, value: FakeResponse) {
    this.entries.set(keyOf(request), value)
  }
  async addAll(requests: Array<string | { url: string }>) {
    for (const request of requests) {
      const url = typeof request === 'string' ? request : request.url
      this.entries.set(keyOf(url), response(`precached ${url}`))
    }
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }
  async delete(request: string | FakeRequest) {
    return this.entries.delete(keyOf(request))
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async match(request: string | FakeRequest, options?: { cacheName?: string }) {
    const names = options?.cacheName ? [options.cacheName] : [...this.stores.keys()]
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request)
      if (hit) return hit
    }
    return undefined
  }
  /** Every URL stored in any cache. */
  allUrls() {
    return [...this.stores.values()].flatMap((cache) => [...cache.entries.keys()])
  }
}

function loadWorker(build = 'build-1') {
  const listeners = new Map<string, Listener>()
  const caches = new FakeCacheStorage()
  const fetch = vi.fn(async (request: FakeRequest | string) => response(`network ${keyOf(request)}`))
  const self = {
    location: { href: `${ORIGIN}/sw.js?v=${build}`, origin: ORIGIN },
    registration: { navigationPreload: { enable: vi.fn(async () => undefined) } },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  } as Record<string, unknown>
  vm.runInNewContext(SOURCE, { self, caches, fetch, URL, Request: class { constructor(public url: string) {} }, Response, Promise, Set, Math })
  const api = self.__kledgSw as {
    routeRequest: (request: FakeRequest & { origin: string }) => Route
    SHELL_CACHE: string
    STATIC_CACHE: string
    SHARE_CACHE: string
    PRECACHE_URLS: string[]
    OFFLINE_URL: string
  }

  /** Dispatches a lifecycle event and waits for what it asked to wait for. */
  async function lifecycle(type: 'install' | 'activate') {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => (pending = promise) })
    await pending
  }

  /** Dispatches a fetch; returns the answer of the worker, or null when it lets the browser handle the request. */
  async function dispatchFetch(url: string, init: { method?: string; mode?: string } = {}) {
    const request = { url: new URL(url, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }
    let answer = null as Promise<FakeResponse> | null
    listeners.get('fetch')!({
      request,
      preloadResponse: Promise.resolve(undefined),
      respondWith: (promise: Promise<FakeResponse>) => (answer = promise),
    })
    return answer === null ? null : await answer
  }

  return { api, self, caches, fetch, listeners, lifecycle, dispatchFetch }
}

describe('routeRequest', () => {
  const { api } = loadWorker()
  const route = (url: string, init: { method?: string; mode?: string } = {}) =>
    api.routeRequest({ url: new URL(url, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors', origin: ORIGIN })

  it('never touches API calls, whatever the method or mode', () => {
    expect(route('/api/entries')).toBe('bypass')
    expect(route('/api/reports/balance-sheet?year=2026')).toBe('bypass')
    expect(route('/api/fec', { mode: 'navigate' })).toBe('bypass')
    expect(route('/api/entries', { method: 'POST' })).toBe('bypass')
    expect(route('/api')).toBe('bypass')
  })

  it('sends page navigations to the network (offline page on failure)', () => {
    expect(route('/acme/entries', { mode: 'navigate' })).toBe('navigation')
    expect(route('/', { mode: 'navigate' })).toBe('navigation')
    expect(route('/login', { mode: 'navigate' })).toBe('navigation')
  })

  it('caches hashed build assets only', () => {
    expect(route('/_next/static/chunks/app-3f9a.js')).toBe('static')
    expect(route('/_next/static/media/geist.woff2')).toBe('static')
    expect(route('/_next/static/css/a1b2.css')).toBe('static')
    expect(route('/_next/image?url=%2Flogo.png&w=64')).toBe('bypass')
    expect(route('/_next/data/build/page.json')).toBe('bypass')
    expect(route('/_next/static/x?_rsc=1')).toBe('bypass')
  })

  it('serves the precached public files (offline page logo, icons) from the shell cache', () => {
    expect(route('/logo.svg')).toBe('shell')
    expect(route('/icons/icon-192.png')).toBe('shell')
    expect(route('/offline.html')).toBe('shell')
  })

  it('leaves authenticated content and everything else to the browser', () => {
    // Server Component payloads of client navigations carry the page data.
    expect(route('/acme/entries?_rsc=abc')).toBe('bypass')
    expect(route('/acme/reports/balance-sheet')).toBe('bypass')
    expect(route('/manifest.webmanifest')).toBe('bypass')
    expect(route('/logo.svg?company=acme')).toBe('bypass')
    expect(route('/auth/signout', { method: 'POST', mode: 'navigate' })).toBe('bypass')
    expect(route('/acme/entries', { method: 'HEAD' })).toBe('bypass')
  })

  it('never handles another origin', () => {
    expect(route('https://cdn.example/_next/static/chunks/a.js')).toBe('bypass')
    expect(route('https://evil.example/', { mode: 'navigate' })).toBe('bypass')
  })
})

describe('service worker lifecycle', () => {
  let worker: ReturnType<typeof loadWorker>
  beforeEach(() => {
    worker = loadWorker('build-2')
  })

  it('names its caches after the build', () => {
    expect(worker.api.SHELL_CACHE).toBe('kledg-shell-build-2')
    expect(worker.api.STATIC_CACHE).toBe('kledg-static-build-2')
  })

  it('precaches the offline page and the icons only, and waits to be asked before taking over', async () => {
    await worker.lifecycle('install')
    expect(worker.api.PRECACHE_URLS).toEqual(['/offline.html', '/logo.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'])
    const shell = await worker.caches.open(worker.api.SHELL_CACHE)
    expect([...shell.entries.keys()].map((url) => new URL(url).pathname)).toEqual(worker.api.PRECACHE_URLS)
    expect(worker.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('takes over when the page asks (Nouvelle version disponible)', () => {
    worker.listeners.get('message')!({ data: { type: 'SKIP_WAITING' } })
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce()
    worker.listeners.get('message')!({ data: { type: 'OTHER' } })
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce()
  })

  it('deletes the caches of older builds on activate, and leaves caches it does not own', async () => {
    await worker.caches.open('kledg-static-build-1')
    await worker.caches.open('kledg-shell-build-1')
    await worker.caches.open('other-app')
    await worker.caches.open(worker.api.SHELL_CACHE)
    await worker.lifecycle('activate')
    expect((await worker.caches.keys()).sort()).toEqual(['kledg-shell-build-2', 'other-app'])
    expect((worker.self.clients as { claim: () => void }).claim).toHaveBeenCalledOnce()
  })
})

describe('service worker fetch handling', () => {
  let worker: ReturnType<typeof loadWorker>
  beforeEach(async () => {
    worker = loadWorker()
    await worker.lifecycle('install')
  })

  it('lets API calls through without answering or storing them', async () => {
    expect(await worker.dispatchFetch('/api/entries?companyId=acme')).toBeNull()
    expect(await worker.dispatchFetch('/api/entries', { method: 'POST' })).toBeNull()
    expect(worker.caches.allUrls().some((url) => url.includes('/api/'))).toBe(false)
  })

  it('answers navigations from the network and never stores the page', async () => {
    const page = await worker.dispatchFetch('/acme/reports/balance-sheet', { mode: 'navigate' })
    expect(page?.body).toBe(`network ${ORIGIN}/acme/reports/balance-sheet`)
    expect(worker.caches.allUrls().some((url) => url.includes('/acme/'))).toBe(false)
  })

  it('shows the offline page when a navigation fails', async () => {
    worker.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const page = await worker.dispatchFetch('/acme/entries', { mode: 'navigate' })
    expect(page?.body).toBe('precached /offline.html')
  })

  it('serves the offline page logo from the shell cache, without the network', async () => {
    const logo = await worker.dispatchFetch('/logo.svg')
    expect(logo?.body).toBe('precached /logo.svg')
    expect(worker.fetch).not.toHaveBeenCalled()
  })

  it('serves build assets from the cache once fetched', async () => {
    const url = '/_next/static/chunks/main-abc123.js'
    const first = await worker.dispatchFetch(url)
    const second = await worker.dispatchFetch(url)
    expect(first?.body).toBe(`network ${ORIGIN}${url}`)
    expect(second?.body).toBe(first?.body)
    expect(worker.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not store failed or opaque asset answers', async () => {
    worker.fetch.mockResolvedValueOnce(response('missing', 404))
    await worker.dispatchFetch('/_next/static/chunks/gone.js')
    worker.fetch.mockResolvedValueOnce(response('', 0, 'opaque'))
    await worker.dispatchFetch('/_next/static/chunks/opaque.js')
    const stored = await worker.caches.open(worker.api.STATIC_CACHE)
    expect(stored.entries.size).toBe(0)
  })
})

describe('files shared from another app (share target)', () => {
  /** The POST the browser sends to /share with the shared files. */
  async function share(worker: ReturnType<typeof loadWorker>, files: File[]) {
    const form = new FormData()
    form.set('title', 'Facture')
    for (const file of files) form.append('files', file)
    let answer = null as Promise<Response> | null
    worker.listeners.get('fetch')!({
      request: { url: `${ORIGIN}/share`, method: 'POST', mode: 'navigate', formData: async () => form },
      preloadResponse: Promise.resolve(undefined),
      respondWith: (promise: Promise<Response>) => (answer = promise),
    })
    return answer === null ? null : await answer
  }

  it('routes only a same-origin POST to /share, never another POST', () => {
    const { api } = loadWorker()
    const route = (url: string, method: string) => api.routeRequest({ url, method, mode: 'navigate', origin: ORIGIN })
    expect(route(`${ORIGIN}/share`, 'POST')).toBe('share')
    expect(route(`${ORIGIN}/share`, 'GET')).toBe('navigation')
    expect(route(`${ORIGIN}/share/other`, 'POST')).toBe('bypass')
    expect(route('https://elsewhere.example/share', 'POST')).toBe('bypass')
  })

  it('keeps the files on the device, replaces the previous share and opens the /share page', async () => {
    const worker = loadWorker()
    await share(worker, [new File(['old'], 'ancien.pdf', { type: 'application/pdf' })])
    const answer = await share(worker, [new File(['%PDF'], 'facture août.pdf', { type: 'application/pdf' }), new File([''], 'vide.png', { type: 'image/png' })])
    expect(answer?.status).toBe(303)
    expect(answer?.headers.get('location')).toBe(`${ORIGIN}/share?files=1&skipped=1`)
    const cache = await worker.caches.open(worker.api.SHARE_CACHE)
    expect([...cache.entries.keys()]).toEqual([`${ORIGIN}/share/file/0`])
    const kept = (await cache.match('/share/file/0')) as unknown as Response
    expect(kept.headers.get('Content-Type')).toBe('application/pdf')
    expect(decodeURIComponent(kept.headers.get('X-Kledg-File-Name') ?? '')).toBe('facture août.pdf')
    expect(worker.fetch).not.toHaveBeenCalled()
  })

  it('keeps the shared files when a new build activates', async () => {
    const worker = loadWorker()
    await share(worker, [new File(['%PDF'], 'f.pdf', { type: 'application/pdf' })])
    await worker.lifecycle('activate')
    expect(await worker.caches.keys()).toContain(worker.api.SHARE_CACHE)
  })
})
