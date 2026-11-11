/**
 * Authorization matrix: anonymous callers, a member of another company, and the coverage of every companyRoute handler. Cases and setup are shared by the matrix
 * files (./helpers/authorization-matrix.ts); this file runs on its own test
 * database, so the files run in parallel. Skipped when the test database
 * server is unreachable.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix')
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

import { available, useMatrix, ids, call, WRITES, READS } from './helpers/authorization-matrix'

describe.skipIf(!available)('authorization matrix', () => {
  const reseed = useMatrix('matrix')

  describe('anonymous', () => {
    beforeAll(reseed)
    it.each([...WRITES, ...READS].map((c) => [c.label, c] as const))('%s: 401', async (_label, c) => {
      expect((await call('anonymous', c)).status).toBe(401)
    })
  })

  describe('member of company B', () => {
    beforeAll(reseed)
    it.each([...WRITES, ...READS].map((c) => [c.label, c] as const))('%s on company A: 404', async (_label, c) => {
      // Direct additions, role changes and company deletion are reserved to instance administrators: 403 before any lookup
      const adminOnly = (c.route === 'members' && c.method !== 'GET') || (c.route === 'member' && c.method !== 'DELETE') || c.label === 'delete company'
      const expected = adminOnly ? 403 : 404
      expect((await call('memberB', c)).status).toBe(expected)
    })

    it('gets 404 on the company slug too', async () => {
      expect((await call('memberB', { ...READS[0], path: () => `/api/entries?companyId=${ids.aSlug}` })).status).toBe(404)
    })

    it('only lists its own company', async () => {
      const response = await call('memberB', { label: 'companies', route: 'companies', method: 'GET', path: () => '/api/companies' })
      const companies = (await response.json()) as Array<{ id: string }>
      expect(companies.map((c) => c.id)).toEqual([ids.bCompany])
    })
  })
})


// Runs without a database: the inventory of handlers against the cases above.
describe('authorization matrix coverage', () => {
  it('[KLEDG-R3-AUTHZ-06] has a case for every companyRoute handler of app/api', () => {
    // The cases live in the shared module and in the matrix files (some groups call routes of their own)
    const dir = path.join(process.cwd(), 'lib/api/__tests__')
    const matrixFiles = readdirSync(dir).filter((name) => /^authorization-matrix.*\.test\.ts$/.test(name)).map((name) => path.join(dir, name))
    const source = [path.join(dir, 'helpers/authorization-matrix.ts'), ...matrixFiles].map((file) => readFileSync(file, 'utf8')).join('\n')
    const modules = new Map<string, string>()
    for (const match of source.matchAll(/^\s+(\w+): \(\) => import\('@\/(app\/api\/[^']+)\/route'\)/gm)) modules.set(match[2], match[1])
    const covered = new Set([...source.matchAll(/route: '(\w+)',\s*method: '(\w+)'/g)].map((m) => `${m[1]} ${m[2]}`))
    const missing: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name)
        if (statSync(file).isDirectory()) walk(file)
        else if (name === 'route.ts') {
          const folder = path.relative(process.cwd(), dir).split(path.sep).join('/')
          for (const match of readFileSync(file, 'utf8').matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*companyRoute\b/g)) {
            const route = modules.get(folder)
            if (!route || !covered.has(`${route} ${match[1]}`)) missing.push(`${match[1]} /${folder.replace(/^app\//, '')}`)
          }
        }
      }
    }
    walk(path.join(process.cwd(), 'app/api'))
    expect(missing, 'Add these handlers to the matrix (WRITES, READS, READS_LET_THROUGH or OWN_PREFERENCES)').toEqual([])
  })
})
