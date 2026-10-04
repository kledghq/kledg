/**
 * Rate limit rules declared by a customised instance (INSTANCE_RATE_LIMITS,
 * lib/instance/policy.ts) work like Kledg's own, and never replace one of
 * Kledg's rules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ count: 0, keys: [] as string[] }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, _id: string, key: string) => {
      db.keys.push(key)
      return [{ count: ++db.count }]
    }),
  },
}))

vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  INSTANCE_RATE_LIMITS: {
    'instance-signup': { window: 3600, max: 2, message: 'Trop de créations de compte. Réessayez dans une heure.' },
    setup: { window: 1, max: 1000, message: "Règle de l'instance qui ne doit jamais remplacer celle de Kledg." },
  },
}))

import { RateLimitError } from '@/lib/accounting/errors'
import { enforceRateLimit, RATE_LIMIT_RULES, RATE_LIMITS, type RateLimitName } from '@/lib/rate-limit'

describe('rate limits of the instance', () => {
  beforeEach(() => {
    db.count = 0
    db.keys = []
    delete process.env.RATE_LIMIT_DISABLED
  })

  it('are enforced by name like Kledg rules, with their own French message', async () => {
    const name = 'instance-signup' as RateLimitName
    await enforceRateLimit(name, '203.0.113.7')
    await enforceRateLimit(name, '203.0.113.7')
    await expect(enforceRateLimit(name, '203.0.113.7')).rejects.toEqual(
      new RateLimitError('Trop de créations de compte. Réessayez dans une heure.'),
    )
    expect(new Set(db.keys)).toEqual(new Set(['instance-signup|203.0.113.7']))
  })

  it('never replace a rule of Kledg', () => {
    expect(RATE_LIMIT_RULES.setup).toEqual(RATE_LIMITS.setup)
  })
})
