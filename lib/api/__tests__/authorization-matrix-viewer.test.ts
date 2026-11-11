/**
 * Authorization matrix: a viewer of the company. Cases and setup are shared by the matrix
 * files (./helpers/authorization-matrix.ts); this file runs on its own test
 * database, so the files run in parallel. Skipped when the test database
 * server is unreachable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix_viewer')
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
  const reseed = useMatrix('matrix_viewer')

  describe('viewer of company A', () => {
    beforeAll(reseed)
    it.each(WRITES.map((c) => [c.label, c] as const))('%s: 403', async (_label, c) => {
      const response = await call('viewer', c)
      expect(response.status).toBe(403)
      const { error } = (await response.json()) as { error: string }
      expect(error).toMatch(/[Aa]ction (non autorisée|réservée)/)
    })

    it.each(READS.map((c) => [c.label, c] as const))('%s: 200', async (_label, c) => {
      expect((await call('viewer', c)).status).toBe(200)
    })

    it('reads by slug as well as by id', async () => {
      const bySlug = await call('viewer', { ...READS[0], path: () => `/api/entries?companyId=${ids.aSlug}` })
      expect(bySlug.status).toBe(200)
      const entries = (await bySlug.json()) as Array<{ companyId: string }>
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((e) => e.companyId === ids.aCompany)).toBe(true)
    })
  })
})
