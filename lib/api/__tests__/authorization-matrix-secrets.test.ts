/**
 * Authorization matrix: responses that must never carry a secret. Cases and setup are shared by the matrix
 * files (./helpers/authorization-matrix.ts); this file runs on its own test
 * database, so the files run in parallel. Skipped when the test database
 * server is unreachable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix_secrets')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  // Routes that reach Qonto (invoice import) must never leave the machine: a closed local port answers at once
  process.env.QONTO_API_URL = 'http://127.0.0.1:9/v2'
  // Same for the other bank providers (Ponto institutions, Revolut), and any other host is refused below
  process.env.PONTO_API_URL = 'http://127.0.0.1:9'
  process.env.REVOLUT_API_URL = 'http://127.0.0.1:9'
})

vi.mock('@/lib/session', async () => {
  const { session } = await import('@/lib/api/__tests__/helpers/authorization-matrix')
  return { getCurrentUser: async () => session.user }
})

import { available, useMatrix, prisma, ids, SECRET, Call, call, A, WRITES, READS } from './helpers/authorization-matrix'

describe.skipIf(!available)('authorization matrix', () => {
  const reseed = useMatrix('matrix_secrets')

  describe('responses never carry secrets', () => {
    /** Values seeded in secret columns: none may appear in any response. */
    const SECRETS = {
      bankSecret: SECRET,
      bankSecretEncrypted: 'encrypted-secret',
      passwordHash: 'scrypt-password-hash-never-returned',
      sessionToken: 'session-token-never-returned',
      apiKeyHash: 'api-key-hash-never-returned',
      githubToken: 'github-token-encrypted-never-returned',
      oauthSecret: 'oauth-client-secret-never-returned',
    }
    /** Keys that name a secret: a response object never has them, whatever their value. */
    const FORBIDDEN_KEYS = new Set([
      'password',
      'secretKey',
      'secretKeyEncrypted',
      'credentials',
      'token',
      'tokenEncrypted',
      'accessToken',
      'refreshToken',
      'idToken',
      'clientSecret',
      'key',
    ])

    /** Reads beyond the matrix that return connections, accounts or users. */
    const SECRET_READS: Call[] = [
      { label: 'bank connections', route: 'bankConnections', method: 'GET', path: () => `/api/banking/connections?companyId=${A()}` },
      { label: 'bank accounts', route: 'bankAccounts', method: 'GET', path: () => `/api/banking/accounts?companyId=${A()}` },
      { label: 'qonto status', route: 'qontoStatus', method: 'GET', path: () => `/api/qonto/status?companyId=${A()}` },
      { label: 'AI access grants', route: 'grants', method: 'GET', path: () => '/api/ai-access/grants' },
    ]
    const ADMIN_READS: Call[] = [{ label: 'users search', route: 'users', method: 'GET', path: () => '/api/users?search=test' }]

    function forbiddenKeysOf(value: unknown, path = '$'): string[] {
      if (Array.isArray(value)) return value.flatMap((item, i) => forbiddenKeysOf(item, `${path}[${i}]`))
      if (!value || typeof value !== 'object') return []
      return Object.entries(value).flatMap(([key, child]) => [
        ...(FORBIDDEN_KEYS.has(key) ? [`${path}.${key}`] : []),
        ...forbiddenKeysOf(child, `${path}.${key}`),
      ])
    }

    beforeAll(async () => {
      await reseed()
      const now = new Date()
      await prisma.authAccount.create({
        data: { id: 'acc-cadmin', accountId: 'u-cadmin', providerId: 'credential', userId: 'u-cadmin', password: SECRETS.passwordHash, createdAt: now, updatedAt: now },
      })
      await prisma.session.create({
        data: { id: 's-cadmin', token: SECRETS.sessionToken, userId: 'u-cadmin', expiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now },
      })
      await prisma.apikey.create({ data: { id: 'key-cadmin', referenceId: 'u-cadmin', key: SECRETS.apiKeyHash, name: 'Claude', createdAt: now, updatedAt: now } })
      await prisma.updateConnection.create({ data: { owner: 'kledghq', repo: 'kledg', tokenEncrypted: SECRETS.githubToken, tokenLast4: 'abcd' } })
      await prisma.bankConnection.update({ where: { id: (await prisma.bankAccount.findUniqueOrThrow({ where: { id: ids.aBankAccount } })).bankConnectionId }, data: { integrationId: ids.aIntegration, provider: 'QONTO' } })
    })

    const cases = (['companyAdmin', 'admin'] as const).flatMap((who) =>
      [...READS, ...SECRET_READS, ...(who === 'admin' ? ADMIN_READS : [])].map((c) => [`${who}: ${c.label}`, who, c] as const),
    )

    it.each(cases)('%s', async (_label, who, c) => {
      const response = await call(who, c)
      expect(response.status, c.label).toBe(200)
      const text = await response.text()
      for (const [name, secret] of Object.entries(SECRETS)) expect(text, `${c.label} leaks ${name}`).not.toContain(secret)
      expect(forbiddenKeysOf(JSON.parse(text)), c.label).toEqual([])
    })

    it('reads bank credentials only masked, through their own route', async () => {
      const text = await (await call('companyAdmin', WRITES.find((w) => w.label === 'read bank credentials')!)).text()
      for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret)
    })
  })
})
