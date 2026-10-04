/**
 * In-memory GitHub API for tests: routes are "METHOD /path" (query string
 * included when given). Every request is recorded; a request to any other
 * host than api.github.com fails the test.
 */

import { setGitHubFetch } from '../github'

export interface FakeResponse {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export type FakeHandler = FakeResponse | ((request: { body: unknown; url: URL }) => FakeResponse)

export interface FakeCall {
  method: string
  path: string
  body: unknown
  authorization: string | null
}

export function fakeGitHub(routes: Record<string, FakeHandler>) {
  const calls: FakeCall[] = []
  setGitHubFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin !== 'https://api.github.com') throw new Error(`Unexpected host ${url.origin}`)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const full = `${method} ${url.pathname}${url.search}`
    const short = `${method} ${url.pathname}`
    calls.push({ method, path: `${url.pathname}${url.search}`, body, authorization: headers.get('authorization') })
    const handler = routes[full] ?? routes[short]
    if (!handler) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }
    const res = typeof handler === 'function' ? handler({ body, url }) : handler
    const status = res.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), { status, headers: res.headers })
  }) as typeof fetch)
  return {
    calls,
    called: (method: string, path: string) => calls.some((c) => c.method === method && c.path.split('?')[0] === path),
  }
}

export function resetGitHub() {
  setGitHubFetch(null)
}

export const TOKEN = 'github_pat_' + 'A'.repeat(70) + 'wxyz'
