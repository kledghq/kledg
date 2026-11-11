/**
 * GET /api/cron/period-locks closes periods, which nothing reopens without
 * an administrator. Without CRON_SECRET the route was public (KLEDG-R3-INPUT-03
 * limited it to twice a day), so anyone could close a period hours before the
 * schedule. Now the automatic closing runs only for a request carrying the
 * CRON_SECRET bearer token: without the secret it does nothing (a warning
 * logged once per server). A skip identical to the last one recorded writes
 * no new audit row.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cron_keyless_period_lock')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe.skipIf(!available)('[KLEDG-R3-INPUT-03] keyless period-lock cron', () => {
  let prisma: typeof import('@/lib/prisma').prisma
  let companyId = ''
  let fiscalYearId = ''

  beforeAll(async () => {
    await prepareTestDatabase('cron_keyless_period_lock')
    prisma = (await import('@/lib/prisma')).prisma
    const company = await prisma.company.create({
      data: { name: 'brouillons', slug: 'brouillons', siren: '333333333', deadlineSettings: { periodAutoLock: 'monthly', periodAutoLockDelayDays: 0 } },
    })
    companyId = company.id
    const year = new Date().getUTCFullYear()
    const fy = await prisma.fiscalYear.create({ data: { companyId, year, startDate: day(`${year - 1}-01-01`), endDate: day(`${year + 1}-12-31`) } })
    fiscalYearId = fy.id
    const journal = await prisma.journal.create({ data: { companyId, code: 'OD', label: 'OD' } })
    await prisma.accountingEntry.create({ data: { companyId, journalId: journal.id, fiscalYearId: fy.id, entryNumber: 'BR-1', date: day(`${year - 1}-02-10`) } })
  })

  it('does nothing without CRON_SECRET, and logs it once', async () => {
    delete process.env.CRON_SECRET
    const { logger } = await import('@/lib/logger')
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    try {
      const { GET } = await import('@/app/api/cron/period-locks/route')
      for (let i = 0; i < 3; i++) {
        const response = await GET(new Request('http://localhost/api/cron/period-locks'))
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ success: false, skipped: 'cron-secret-missing' })
      }
      expect(warn.mock.calls.filter(([message]) => /CRON_SECRET/.test(String(message)))).toHaveLength(1)
      expect(await prisma.auditLog.count({ where: { action: { startsWith: 'PERIOD_AUTO_LOCK' }, companyId } })).toBe(0)
      expect(await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } })).toMatchObject({ periodLockedThrough: null })
    } finally {
      warn.mockRestore()
    }
  })

  it('records a skip again once it changes (another date or reason)', async () => {
    const { lockOpenYearsThrough } = await import('@/lib/accounting/period-lock/auto-lock.service')
    const { withSystemContext } = await import('@/lib/rls/context')
    const year = new Date().getUTCFullYear()
    const run = (through: string) => withSystemContext('cron:period-lock', () => lockOpenYearsThrough(companyId, through), { companyIds: [companyId] })
    const before = await prisma.auditLog.count({ where: { action: 'PERIOD_AUTO_LOCK_SKIPPED', companyId } })
    expect((await run(`${year - 1}-03-31`)).skipped).toEqual([{ fiscalYearId, reason: expect.any(String) }])
    expect((await run(`${year - 1}-03-31`)).skipped).toHaveLength(1)
    expect(await prisma.auditLog.count({ where: { action: 'PERIOD_AUTO_LOCK_SKIPPED', companyId } })).toBe(before + 1)
  })

  it('runs on every call with the bearer token when CRON_SECRET is set, and refuses a call without it', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests'
    try {
      const { GET } = await import('@/app/api/cron/period-locks/route')
      expect((await GET(new Request('http://localhost/api/cron/period-locks'))).status).toBe(401)
      for (let i = 0; i < 3; i++) {
        const response = await GET(new Request('http://localhost/api/cron/period-locks', { headers: { authorization: 'Bearer cron-secret-for-tests' } }))
        expect(await response.json()).toMatchObject({ success: true, companies: 1 })
      }
    } finally {
      delete process.env.CRON_SECRET
    }
  })
})
