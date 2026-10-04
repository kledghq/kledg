import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    updateConnection: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        store.row = { ...create, createdAt: new Date(), updatedAt: new Date() }
        return store.row
      }),
      findUnique: vi.fn(async () => store.row),
      deleteMany: vi.fn(async () => {
        const count = store.row ? 1 : 0
        store.row = null
        return { count }
      }),
    },
  },
}))

import {
  deleteConnection,
  getConnectionSummary,
  loadConnection,
  repoKind,
  saveConnection,
  summarize,
  validateToken,
} from '../connection'
import { tokenCreationUrl } from '../token-url'
import { fakeGitHub, resetGitHub, TOKEN, type FakeHandler } from './fake-github'

const target = { owner: 'acme', repo: 'compta' }
const pkg = (name: string) => ({ content: Buffer.from(JSON.stringify({ name, version: '0.1.0' })).toString('base64') })

function repoRoutes(repo: Record<string, unknown>, overrides: Record<string, FakeHandler> = {}): Record<string, FakeHandler> {
  return {
    'GET /repos/acme/compta': {
      body: { full_name: 'acme/compta', default_branch: 'main', fork: false, ...repo },
      headers: { 'github-authentication-token-expiration': '2026-12-31 00:00:00 UTC' },
    },
    'GET /repos/acme/compta/contents/package.json?ref=main': { body: pkg('kledg') },
    'GET /repos/acme/compta/pulls?per_page=1': { body: [] },
    'GET /repos/acme/compta/actions/workflows?per_page=1': { body: { workflows: [] } },
    'GET /repos/acme/compta/actions/variables?per_page=1': { body: { variables: [] } },
    'GET /repos/acme/compta/deployments?per_page=1': { body: [] },
    ...overrides,
  }
}

const forbidden = { status: 403, body: { message: 'Resource not accessible by personal access token' } }

beforeEach(() => {
  store.row = null
  process.env.BETTER_AUTH_SECRET = 'test-secret-for-encryption'
  delete process.env.ENCRYPTION_KEY
})
afterEach(() => resetGitHub())

describe('repoKind (fork or copy)', () => {
  it('detects a fork of kledghq/kledg, directly or through another fork', () => {
    expect(repoKind({ fork: true, parent: { full_name: 'kledghq/kledg' } })).toBe('fork')
    expect(repoKind({ fork: true, parent: { full_name: 'bob/kledg' }, source: { full_name: 'KledgHQ/kledg' } })).toBe('fork')
  })

  it('detects a copy (Vercel button) and forks of other projects', () => {
    expect(repoKind({ fork: false })).toBe('copy')
    expect(repoKind({ fork: true, parent: { full_name: 'someone/else' }, source: { full_name: 'someone/else' } })).toBe('other-fork')
  })
})

describe('validateToken', () => {
  it('accepts a copy holding Kledg with the required permissions', async () => {
    fakeGitHub(repoRoutes({}))
    const result = await validateToken(TOKEN, target)
    expect(result.kind).toBe('copy')
    expect(result.defaultBranch).toBe('main')
    expect(result.expiresAt?.toISOString()).toBe('2026-12-31T00:00:00.000Z')
    expect(result.checks.every((c) => c.ok)).toBe(true)
  })

  it('accepts a fork of kledghq/kledg', async () => {
    fakeGitHub(repoRoutes({ fork: true, parent: { full_name: 'kledghq/kledg' }, source: { full_name: 'kledghq/kledg' } }))
    expect((await validateToken(TOKEN, target)).kind).toBe('fork')
  })

  it('rejects classic tokens and garbage before calling GitHub', async () => {
    const fake = fakeGitHub({})
    await expect(validateToken('ghp_' + 'a'.repeat(36), target)).rejects.toThrow('fine-grained')
    await expect(validateToken('github_pat_short', target)).rejects.toThrow('fine-grained')
    expect(fake.calls).toHaveLength(0)
  })

  it('explains a revoked or expired token', async () => {
    fakeGitHub({ 'GET /repos/acme/compta': { status: 401, body: { message: 'Bad credentials' } } })
    await expect(validateToken(TOKEN, target)).rejects.toThrow('Jeton GitHub refusé')
  })

  it('explains a token without access to the repository', async () => {
    fakeGitHub({})
    await expect(validateToken(TOKEN, target)).rejects.toThrow('Only select repositories')
  })

  it('rejects a repository that does not hold Kledg', async () => {
    fakeGitHub(repoRoutes({}, { 'GET /repos/acme/compta/contents/package.json?ref=main': { body: pkg('something-else') } }))
    await expect(validateToken(TOKEN, target)).rejects.toThrow('ne contient pas Kledg')
  })

  it('rejects forks of other projects', async () => {
    fakeGitHub(repoRoutes({ fork: true, parent: { full_name: 'x/y' }, source: { full_name: 'x/y' } }))
    await expect(validateToken(TOKEN, target)).rejects.toThrow("fork d'un autre projet")
  })

  it('lists missing required permissions', async () => {
    fakeGitHub(
      repoRoutes({}, {
        'GET /repos/acme/compta/pulls?per_page=1': forbidden,
        'GET /repos/acme/compta/actions/workflows?per_page=1': forbidden,
      }),
    )
    await expect(validateToken(TOKEN, target)).rejects.toThrow('Permissions manquantes sur le jeton : Pull requests, Actions')
  })

  it('accepts missing optional permissions and reports them', async () => {
    fakeGitHub(repoRoutes({}, { 'GET /repos/acme/compta/deployments?per_page=1': forbidden }))
    const result = await validateToken(TOKEN, target)
    expect(result.checks.find((c) => c.key === 'deployments')).toMatchObject({ ok: false, required: false })
  })
})

describe('stored connection', () => {
  it('stores the token encrypted and only exposes its last 4 characters', async () => {
    fakeGitHub(repoRoutes({}))
    const validation = await validateToken(TOKEN, target)
    await saveConnection(TOKEN, validation, 'admin-1')

    expect(store.row?.tokenEncrypted).toBeTruthy()
    expect(String(store.row?.tokenEncrypted)).not.toContain(TOKEN)
    const summary = await getConnectionSummary()
    expect(JSON.stringify(summary)).not.toContain(TOKEN)
    expect(summary).toMatchObject({ owner: 'acme', repo: 'compta', kind: 'copy', tokenLast4: 'wxyz' })

    const loaded = await loadConnection()
    expect(loaded.token).toBe(TOKEN)

    expect(await deleteConnection()).toBe(true)
    expect(await getConnectionSummary()).toBeNull()
    await expect(loadConnection()).rejects.toThrow('Aucun dépôt GitHub connecté')
  })

  it('reports an unreadable token after a key change', async () => {
    fakeGitHub(repoRoutes({}))
    await saveConnection(TOKEN, await validateToken(TOKEN, target), 'admin-1')
    process.env.BETTER_AUTH_SECRET = 'another-secret'
    await expect(loadConnection()).rejects.toThrow('illisible')
  })

  it('warns before expiry', () => {
    const base = { owner: 'a', repo: 'b', isFork: false, defaultBranch: 'main', tokenLast4: 'abcd', createdAt: new Date(), updatedAt: new Date() }
    const now = new Date('2026-10-01T00:00:00Z')
    expect(summarize({ ...base, tokenExpiresAt: new Date('2026-10-10T00:00:00Z') }, now)).toMatchObject({ expiresSoon: true, expired: false })
    expect(summarize({ ...base, tokenExpiresAt: new Date('2026-12-10T00:00:00Z') }, now)).toMatchObject({ expiresSoon: false, expired: false })
    expect(summarize({ ...base, tokenExpiresAt: new Date('2026-09-10T00:00:00Z') }, now)).toMatchObject({ expiresSoon: false, expired: true })
    expect(summarize({ ...base, tokenExpiresAt: null }, now)).toMatchObject({ expiresSoon: false, expired: false })
  })
})

describe('tokenCreationUrl', () => {
  it('prefills a minimal fine-grained token', () => {
    const url = new URL(tokenCreationUrl('acme'))
    expect(url.origin + url.pathname).toBe('https://github.com/settings/personal-access-tokens/new')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      name: 'Kledg updates',
      expires_in: '90',
      target_name: 'acme',
      contents: 'write',
      pull_requests: 'write',
      actions: 'write',
      variables: 'write',
      workflows: 'write',
      deployments: 'read',
      metadata: 'read',
    })
    expect(url.searchParams.get('name')!.length).toBeLessThanOrEqual(40)
  })

  it('omits an invalid owner', () => {
    expect(new URL(tokenCreationUrl('a/b')).searchParams.has('target_name')).toBe(false)
  })
})
