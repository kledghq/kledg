/**
 * Permissions and CSRF checks of the /api/updates routes: every handler is
 * admin only (401 signed out, 403 for other users), state-changing ones
 * refuse cross-site requests, and the token never comes back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: null; role: string | null } }))

const policy = vi.hoisted(() => ({ refused: new Set<string>() }))

vi.mock('@/lib/session', () => ({ getCurrentUser: vi.fn(async () => session.user) }))
// The real policy (every hook and constant of the extension point), with the two refusals replaced.
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  isActionAllowed: vi.fn(async (action: string) => !policy.refused.has(action)),
  actionRefusalMessage: vi.fn(() => 'Refusé par la politique de cette instance.'),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => {}) }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))
vi.mock('@/lib/updates/overview', () => ({
  getUpdateOverview: vi.fn(async () => ({ state: 'up-to-date', current: { version: '0.1.0' }, connection: null })),
}))
vi.mock('@/lib/updates/connection', () => ({
  validateToken: vi.fn(async () => ({
    repository: { owner: 'acme', repo: 'compta' },
    kind: 'copy',
    defaultBranch: 'main',
    expiresAt: null,
    checks: [],
  })),
  saveConnection: vi.fn(async () => {}),
  deleteConnection: vi.fn(async () => true),
  getConnectionSummary: vi.fn(async () => ({ owner: 'acme', repo: 'compta', tokenLast4: 'wxyz' })),
  loadConnection: vi.fn(async () => ({
    repository: { owner: 'acme', repo: 'compta' },
    kind: 'copy',
    defaultBranch: 'main',
    token: 'github_pat_SECRET',
  })),
}))
vi.mock('@/lib/updates/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/updates/service')>('@/lib/updates/service')
  return {
    ...actual,
    getChannel: vi.fn(async () => 'releases'),
    setChannel: vi.fn(async () => {}),
    getWorkflow: vi.fn(async () => ({ present: true, state: 'active', current: true, sha: 'x' })),
    latestRun: vi.fn(async () => null),
    findUpdatePull: vi.fn(async () => null),
    prepareUpdate: vi.fn(async () => ({ mode: 'workflow', workflowInstalled: false, dispatchedAt: '2026-10-03T00:00:00Z' })),
    mergeUpdatePull: vi.fn(async () => ({ sha: 'b'.repeat(40) })),
    mergeUpstream: vi.fn(async () => ({ sha: 'c'.repeat(40) })),
  }
})

import * as overviewRoute from '../updates/route'
import * as versionRoute from '../updates/version/route'
import * as connectionRoute from '../updates/connection/route'
import * as githubRoute from '../updates/github/route'
import * as prepareRoute from '../updates/prepare/route'
import * as installRoute from '../updates/install/route'
import * as channelRoute from '../updates/channel/route'
import { saveConnection, validateToken } from '@/lib/updates/connection'
import { mergeUpdatePull } from '@/lib/updates/service'
import { getUpdateOverview } from '@/lib/updates/overview'

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>

const SHA = 'a'.repeat(40)
const TOKEN = 'github_pat_' + 'A'.repeat(70)

const ROUTES: Array<{ name: string; method: string; url: string; handler: Handler; body?: unknown }> = [
  { name: 'overview', method: 'GET', url: '/api/updates', handler: overviewRoute.GET },
  { name: 'version', method: 'GET', url: '/api/updates/version', handler: versionRoute.GET },
  { name: 'connect', method: 'POST', url: '/api/updates/connection', handler: connectionRoute.POST, body: { token: TOKEN } },
  { name: 'disconnect', method: 'DELETE', url: '/api/updates/connection', handler: connectionRoute.DELETE },
  { name: 'github status', method: 'GET', url: '/api/updates/github', handler: githubRoute.GET },
  { name: 'prepare', method: 'POST', url: '/api/updates/prepare', handler: prepareRoute.POST },
  {
    name: 'install',
    method: 'POST',
    url: '/api/updates/install',
    handler: installRoute.POST,
    body: { mode: 'pull', pullNumber: 7, headSha: SHA, confirm: true },
  },
  { name: 'channel', method: 'PUT', url: '/api/updates/channel', handler: channelRoute.PUT, body: { channel: 'main' } },
]

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const admin = { id: 'admin-1', email: 'admin@example.com', name: null, role: 'admin' }
const member = { id: 'user-1', email: 'user@example.com', name: null, role: null }

const VERCEL_ENV = {
  VERCEL: '1',
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'acme',
  VERCEL_GIT_REPO_SLUG: 'compta',
  VERCEL_GIT_COMMIT_SHA: SHA,
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, VERCEL_ENV)
})
afterEach(() => {
  for (const key of Object.keys(VERCEL_ENV)) delete process.env[key]
  delete process.env.KLEDG_RUNTIME
})

describe('/api/updates permissions', () => {
  for (const route of ROUTES) {
    it(`${route.method} ${route.name}: 401 signed out`, async () => {
      session.user = null
      const res = await route.handler(request(route.method, route.url, route.body))
      expect(res.status).toBe(401)
    })

    it(`${route.method} ${route.name}: 403 for a non-admin`, async () => {
      session.user = member
      const res = await route.handler(request(route.method, route.url, route.body))
      expect(res.status).toBe(403)
    })

    it(`${route.method} ${route.name}: allowed for an admin`, async () => {
      session.user = admin
      const res = await route.handler(request(route.method, route.url, route.body, { origin: 'http://localhost:3000' }))
      expect(res.status).toBe(200)
      expect(await res.text()).not.toContain('SECRET')
    })
  }
})

describe('/api/updates CSRF', () => {
  const mutating = ROUTES.filter((r) => r.method !== 'GET')

  for (const route of mutating) {
    it(`${route.method} ${route.name}: refuses another origin`, async () => {
      session.user = admin
      const res = await route.handler(request(route.method, route.url, route.body, { origin: 'https://evil.example' }))
      expect(res.status).toBe(403)
    })

    it(`${route.method} ${route.name}: refuses a cross-site fetch`, async () => {
      session.user = admin
      const res = await route.handler(request(route.method, route.url, route.body, { 'sec-fetch-site': 'cross-site' }))
      expect(res.status).toBe(403)
    })
  }
})

describe('/api/updates when the instance policy refuses manage-updates', () => {
  const mutating = ROUTES.filter((r) => r.method !== 'GET')
  afterEach(() => {
    policy.refused.clear()
  })

  for (const route of mutating) {
    it(`${route.method} ${route.name}: refused even for an administrator`, async () => {
      policy.refused.add('manage-updates')
      session.user = admin
      const res = await route.handler(request(route.method, route.url, route.body, { origin: 'http://localhost:3000' }))
      expect(res.status).toBe(403)
      expect(JSON.stringify(await res.json())).toContain('politique de cette instance')
      expect(saveConnection).not.toHaveBeenCalled()
      expect(mergeUpdatePull).not.toHaveBeenCalled()
    })
  }
})

describe('/api/updates behaviour', () => {
  beforeEach(() => {
    session.user = admin
  })

  it('reads the light overview only for ?light=1', async () => {
    await overviewRoute.GET(request('GET', '/api/updates?light=1'))
    await overviewRoute.GET(request('GET', '/api/updates'))
    await overviewRoute.GET(request('GET', '/api/updates?light=yes'))
    expect(vi.mocked(getUpdateOverview).mock.calls.map(([options]) => options?.light)).toEqual([true, false, false])
  })

  it('version returns only the version and commit', async () => {
    const res = await versionRoute.GET(request('GET', '/api/updates/version'))
    expect(Object.keys(await res.json()).sort()).toEqual(['commit', 'version'])
  })

  it('connects the repository Vercel deploys from, whatever the body says', async () => {
    const res = await connectionRoute.POST(request('POST', '/api/updates/connection', { token: TOKEN, owner: 'other', repo: 'repo' }))
    expect(res.status).toBe(200)
    expect(validateToken).toHaveBeenCalledWith(TOKEN, { owner: 'acme', repo: 'compta' })
    const json = await res.json()
    expect(JSON.stringify(json)).not.toContain(TOKEN)
  })

  it('asks for the repository outside Vercel-detected deployments and validates it', async () => {
    delete process.env.VERCEL_GIT_REPO_OWNER
    const res = await connectionRoute.POST(request('POST', '/api/updates/connection', { token: TOKEN, owner: '../x', repo: 'repo' }))
    expect(res.status).toBe(400)
    expect(saveConnection).not.toHaveBeenCalled()
  })

  it('refuses GitHub actions on Docker installs', async () => {
    delete process.env.VERCEL
    process.env.KLEDG_RUNTIME = 'docker'
    for (const route of ROUTES.filter((r) => !['overview', 'version', 'disconnect'].includes(r.name))) {
      const res = await route.handler(request(route.method, route.url, route.body))
      expect(res.status, route.name).toBe(400)
    }
  })

  it('install requires an explicit confirmation and a full commit', async () => {
    let res = await installRoute.POST(request('POST', '/api/updates/install', { mode: 'pull', pullNumber: 7, headSha: SHA }))
    expect(res.status).toBe(400)
    res = await installRoute.POST(request('POST', '/api/updates/install', { mode: 'pull', pullNumber: 7, headSha: 'main', confirm: true }))
    expect(res.status).toBe(400)
    expect(mergeUpdatePull).not.toHaveBeenCalled()
  })

  it('channel accepts only releases, main or off', async () => {
    const res = await channelRoute.PUT(request('PUT', '/api/updates/channel', { channel: 'nightly' }))
    expect(res.status).toBe(400)
  })
})
