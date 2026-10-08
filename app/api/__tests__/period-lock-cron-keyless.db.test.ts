/**
 * KLEDG-R3-INPUT-03: without CRON_SECRET, GET /api/cron/period-locks is
 * public. It used to walk every company on every call and append a
 * PERIOD_AUTO_LOCK_SKIPPED audit row for each company whose period cannot
 * be locked (a draft dated in it), so an anonymous caller grew the
 * append-only audit log at will. Now the keyless route runs at most twice a
 * day for the instance (rule cron-keyless-period-lock), and a skip identical
 * to the last one recorded writes no new row.
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

  it('runs at most twice a day without CRON_SECRET and writes one audit row for an unchanged skip', async () => {
    delete process.env.CRON_SECRET
    delete process.env.RATE_LIMIT_DISABLED
    await prisma.rateLimit.deleteMany({ where: { key: 'cron-keyless-period-lock|instance' } })
    const { GET } = await import('@/app/api/cron/period-locks/route')
    const answers: unknown[] = []
    for (let i = 0; i < 5; i++) {
      const response = await GET(new Request('http://localhost/api/cron/period-locks'))
      expect(response.status).toBe(200)
      answers.push(await response.json())
    }
    expect(answers.slice(0, 2)).toEqual([
      { success: true, companies: 1, locked: 0, skipped: 1 },
      { success: true, companies: 1, locked: 0, skipped: 1 },
    ])
    expect(answers.slice(2)).toEqual(Array(3).fill({ success: true, skipped: 'rate-limited' }))
    expect(await prisma.auditLog.count({ where: { action: 'PERIOD_AUTO_LOCK_SKIPPED', companyId } })).toBe(1)
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

  it('still runs on every call with the bearer token when CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-tests'
    try {
      const { GET } = await import('@/app/api/cron/period-locks/route')
      for (let i = 0; i < 3; i++) {
        const response = await GET(new Request('http://localhost/api/cron/period-locks', { headers: { authorization: 'Bearer cron-secret-for-tests' } }))
        expect(await response.json()).toMatchObject({ success: true, companies: 1 })
      }
    } finally {
      delete process.env.CRON_SECRET
    }
  })
})
