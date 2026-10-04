/**
 * Scheduled bank sync (lib/banking/sync-banks.service.ts) through its two
 * cron routes, /api/cron/sync-banks and its former path /api/cron/sync-qonto,
 * with Prisma and syncIntegration mocked:
 * - with CRON_SECRET, its bearer token is required (401 without it or with
 *   a wrong one);
 * - without CRON_SECRET (keyless mode), anyone may call the route, so it only
 *   syncs integrations not synced for 20 hours, is limited instance-wide,
 *   and answers with a count only;
 * - every active bank integration is synced, Qonto with transactions only;
 * - a failing integration is reported with a French reason and does not
 *   stop the others; the summary lists each run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/integrations/sync', () => ({ syncIntegration: vi.fn() }))
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')),
  withinRateLimit: vi.fn(async () => true),
}))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { syncIntegration } from '@/lib/integrations/sync'
import { IntegrationFeature } from '@/lib/integrations/types'
import { ExternalServiceError, INTERNAL_ERROR_MESSAGE } from '@/lib/accounting/errors'
import { UNEXPECTED_BANK_ERROR_MESSAGE } from '@/lib/banking/errors'
import { syncAllBankIntegrations } from '@/lib/banking/sync-banks.service'
import { withinRateLimit } from '@/lib/rate-limit'
import { GET as syncBanks } from '@/app/api/cron/sync-banks/route'
import { GET as syncQonto } from '@/app/api/cron/sync-qonto/route'

const db = asPrismaMock(prisma)
const SECRET = 'cron-secret-0123456789'

const cron = (authorization?: string) =>
  new Request('https://kledg.example.com/api/cron/sync-banks', { headers: authorization ? { authorization } : {} })

const INTEGRATIONS = [
  { id: 'int-qonto', companyId: 'company-a', provider: 'QONTO' },
  { id: 'int-ponto', companyId: 'company-b', provider: 'PONTO' },
  { id: 'int-revolut', companyId: 'company-c', provider: 'REVOLUT' },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
  db.integration.findMany.mockResolvedValue(INTEGRATIONS)
  vi.mocked(syncIntegration).mockImplementation(async (id) => {
    if (id === 'int-ponto') throw new ExternalServiceError('Ponto est indisponible pour le moment. Réessayez dans quelques minutes.')
    return { success: true, itemsSynced: id === 'int-qonto' ? 12 : 3, matched: 0, errors: [] }
  })
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.ENCRYPTION_KEY
})

describe.each([
  ['/api/cron/sync-banks', syncBanks],
  ['/api/cron/sync-qonto', syncQonto],
])('GET %s', (_path, handler) => {
  it('answers 401 without the bearer token, with a wrong one, or a token of another length', async () => {
    for (const authorization of [undefined, `Bearer ${SECRET.replace('0', '1')}`, `Bearer ${SECRET}x`, SECRET]) {
      const response = await handler(cron(authorization))
      expect(response.status, String(authorization)).toBe(401)
      expect(await response.json()).toEqual({ error: 'Unauthorized' })
    }
    expect(db.integration.findMany).not.toHaveBeenCalled()
    expect(syncIntegration).not.toHaveBeenCalled()
  })

  it('without CRON_SECRET, syncs only integrations not synced for 20 hours and reveals nothing but a count', async () => {
    delete process.env.CRON_SECRET
    const before = Date.now()
    const response = await handler(cron())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, synced: 3 })
    expect(withinRateLimit).toHaveBeenCalledWith('cron-keyless', 'instance')
    const where = db.integration.findMany.mock.calls[0]?.[0]?.where as { OR: [unknown, { lastSyncAt: { lt: Date } }] }
    expect(where.OR[0]).toEqual({ lastSyncAt: null })
    const cutoff = where.OR[1].lastSyncAt.lt.getTime()
    expect(before - cutoff).toBeGreaterThanOrEqual(20 * 3_600_000 - 1000)
    expect(before - cutoff).toBeLessThanOrEqual(20 * 3_600_000 + 1000)
  })

  it('without CRON_SECRET, does nothing once the instance-wide limit is reached', async () => {
    delete process.env.CRON_SECRET
    vi.mocked(withinRateLimit).mockResolvedValueOnce(false)
    const response = await handler(cron('Bearer whatever'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, synced: 0, skipped: 'rate-limited' })
    expect(db.integration.findMany).not.toHaveBeenCalled()
    expect(syncIntegration).not.toHaveBeenCalled()
  })

  it('syncs every integration, keeps going after a failure and returns the summary', async () => {
    const response = await handler(cron(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      synced: 3,
      results: [
        { companyId: 'company-a', integrationId: 'int-qonto', provider: 'QONTO', success: true, itemsSynced: 12, errors: [] },
        {
          companyId: 'company-b',
          integrationId: 'int-ponto',
          provider: 'PONTO',
          success: false,
          itemsSynced: 0,
          errors: ['Ponto est indisponible pour le moment. Réessayez dans quelques minutes.'],
        },
        { companyId: 'company-c', integrationId: 'int-revolut', provider: 'REVOLUT', success: true, itemsSynced: 3, errors: [] },
      ],
    })
  })
})

describe('syncAllBankIntegrations', () => {
  it('reads the active banking integrations of the bank providers only', async () => {
    await syncAllBankIntegrations('key')
    expect(db.integration.findMany).toHaveBeenCalledWith({
      where: { provider: { in: ['QONTO', 'REVOLUT', 'PONTO'] }, status: 'active', type: 'BANKING' },
      select: { id: true, companyId: true, provider: true },
    })
  })

  it('reads Qonto transactions only and the balances of the other providers, over 30 days', async () => {
    await syncAllBankIntegrations('key-1')
    expect(vi.mocked(syncIntegration).mock.calls).toEqual([
      ['int-qonto', 'key-1', [IntegrationFeature.BANKING_TRANSACTIONS], { maxDays: 30 }],
      ['int-ponto', 'key-1', [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS], { maxDays: 30 }],
      ['int-revolut', 'key-1', [IntegrationFeature.BANKING_ACCOUNTS, IntegrationFeature.BANKING_TRANSACTIONS], { maxDays: 30 }],
    ])
  })

  it('keeps the errors a sync reports and hides an unexpected failure behind the French generic message', async () => {
    vi.mocked(syncIntegration).mockImplementation(async (id) => {
      if (id === 'int-qonto') return { success: false, itemsSynced: 1, errors: ["Qonto refuse l'accès"] }
      if (id === 'int-ponto') throw new TypeError('connect ECONNREFUSED 10.0.0.3:5432 password=hunter2')
      return { success: true, itemsSynced: 0, errors: [] }
    })
    const results = await syncAllBankIntegrations('key')
    expect(results.map((r) => [r.integrationId, r.success, r.itemsSynced, r.errors])).toEqual([
      ['int-qonto', false, 1, ["Qonto refuse l'accès"]],
      ['int-ponto', false, 0, [UNEXPECTED_BANK_ERROR_MESSAGE]],
      ['int-revolut', true, 0, []],
    ])
  })

  it('returns an empty summary when no bank is connected', async () => {
    db.integration.findMany.mockResolvedValue([])
    const response = await syncBanks(cron(`Bearer ${SECRET}`))
    expect(await response.json()).toEqual({ success: true, synced: 0, results: [] })
    expect(syncIntegration).not.toHaveBeenCalled()
  })
})

describe('cron handler failures', () => {
  it('answers 500 when no encryption key can be derived', async () => {
    delete process.env.ENCRYPTION_KEY
    const secret = process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_SECRET
    try {
      const response = await syncBanks(cron(`Bearer ${SECRET}`))
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Encryption key not configured' })
      expect(db.integration.findMany).not.toHaveBeenCalled()
    } finally {
      if (secret !== undefined) process.env.BETTER_AUTH_SECRET = secret
    }
  })

  it('answers the generic 500 message when the integrations cannot be read', async () => {
    db.integration.findMany.mockRejectedValue(new Error('relation "integrations" does not exist'))
    const response = await syncBanks(cron(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: INTERNAL_ERROR_MESSAGE })
  })
})
