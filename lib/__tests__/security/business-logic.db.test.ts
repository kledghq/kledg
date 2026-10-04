/**
 * Business-logic integrity: the accounting invariants an attacker (or a
 * confused client) would try to break, exercised through the real routes and
 * services against PostgreSQL (session mocked).
 *
 * - no write into a closed fiscal year;
 * - a validated entry cannot be modified or deleted;
 * - a draft entry must balance, with no negative/overflow amount and at most
 *   two decimals;
 * - a transaction cannot be reconciled twice into two links;
 * - result allocation is guarded on an open year.
 *
 * Plus a pure FEC-import tampering block (no DB): unbalanced or malformed
 * entries are refused.
 *
 * Skipped (DB block) when the test database server is unreachable.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('security_business')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  return { user: null as unknown }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { makeCall, seedTenants, type Handler } from './helpers/tenants'

const available = await testDatabaseAvailable()
const call = makeCall(state)
const ids = {} as Record<string, string>
let prisma: typeof import('@/lib/prisma').prisma
const routes: Record<string, Record<string, Handler>> = {}

async function reseed() {
  await prepareTestDatabase('security_business')
  await seedTenants(prisma, ids)
}

const balanced = (companyId: string, journalId: string, accountId: string, salesId: string, description: string) => ({
  companyId,
  journalId,
  date: '2026-04-01',
  description,
  lines: [
    { accountId, debit: 100, credit: 0 },
    { accountId: salesId, debit: 0, credit: 100 },
  ],
})

describe.skipIf(!available)('business logic integrity', () => {
  beforeEach(async () => {
    if (!prisma) ({ prisma } = await import('@/lib/prisma'))
    routes.entries ??= (await import('@/app/api/entries/route')) as unknown as Record<string, Handler>
    routes.entry ??= (await import('@/app/api/entries/[id]/route')) as unknown as Record<string, Handler>
    routes.reconcile ??= (await import('@/app/api/transactions/[id]/reconcile/route')) as unknown as Record<string, Handler>
    routes.resultAllocation ??= (await import(
      '@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/result-allocation/route'
    )) as unknown as Record<string, Handler>
    await reseed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('[KLEDG-SEC-015] answers a French 400, never a 500, for an entry amount beyond the Decimal(15, 2) column', async () => {
    for (const amount of [1e15, '99999999999999', 1e300]) {
      const body = balanced(ids.aCompany, ids.aJournal, ids.aAccount, ids.aSales, `huge-${amount}`)
      body.lines = [
        { accountId: ids.aAccount, debit: amount as number, credit: 0 },
        { accountId: ids.aSales, debit: 0, credit: amount as number },
      ]
      const response = await call('accountant', { route: routes.entries, method: 'POST', path: '/api/entries', body })
      expect(response.status, String(amount)).toBe(400)
      expect((await response.json()).error, String(amount)).toMatch(/Montant trop élevé/)
    }
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, description: { startsWith: 'huge-' } } })).toBe(0)
  })

  it('refuses a new entry in a closed fiscal year, through the route and the DB trigger', async () => {
    await prisma.fiscalYear.update({ where: { id: ids.aFy }, data: { isClosed: true } })
    const response = await call('accountant', {
      route: routes.entries,
      method: 'POST',
      path: '/api/entries',
      body: balanced(ids.aCompany, ids.aJournal, ids.aAccount, ids.aSales, 'closed-year-write'),
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, description: 'closed-year-write' } })).toBe(0)

    // The database trigger is the backstop: a direct insert is refused too.
    await expect(
      prisma.accountingEntry.create({
        data: { companyId: ids.aCompany, fiscalYearId: ids.aFy, journalId: ids.aJournal, entryNumber: '999', date: new Date('2026-05-01T00:00:00Z'), description: 'direct', status: 'draft' },
      }),
    ).rejects.toBeTruthy()
  })

  it('refuses to modify or delete a validated entry', async () => {
    const patch = await call('accountant', {
      route: routes.entry,
      method: 'PATCH',
      path: `/api/entries/${ids.aValidated}`,
      params: { id: ids.aValidated },
      body: { description: 'hacked' },
    })
    expect(patch.status).toBeGreaterThanOrEqual(400)

    const del = await call('accountant', {
      route: routes.entry,
      method: 'DELETE',
      path: `/api/entries/${ids.aValidated}`,
      params: { id: ids.aValidated },
    })
    expect(del.status).toBeGreaterThanOrEqual(400)

    const row = await prisma.accountingEntry.findUnique({ where: { id: ids.aValidated } })
    expect(row?.description).toBe('Validee')
    expect(row?.status).toBe('validated')
  })

  it('accepts a balanced draft but refuses unbalanced, over-max and sub-cent amounts', async () => {
    const ok = await call('accountant', {
      route: routes.entries,
      method: 'POST',
      path: '/api/entries',
      body: balanced(ids.aCompany, ids.aJournal, ids.aAccount, ids.aSales, 'ok-balanced'),
    })
    expect(ok.status).toBeLessThan(300)

    const bad = (lines: unknown, description: string) =>
      call('accountant', {
        route: routes.entries,
        method: 'POST',
        path: '/api/entries',
        body: { companyId: ids.aCompany, journalId: ids.aJournal, date: '2026-04-02', description, lines },
      })

    const cases: Array<[string, Array<Record<string, number | string>>]> = [
      ['unbalanced', [{ accountId: ids.aAccount, debit: 100, credit: 0 }, { accountId: ids.aSales, debit: 0, credit: 50 }]],
      // Over Decimal(15,2) max: must be rejected, not silently truncated.
      ['over-max', [{ accountId: ids.aAccount, debit: 1e20, credit: 0 }, { accountId: ids.aSales, debit: 0, credit: 1e20 }]],
      // A real third decimal (not float noise): rejected.
      ['sub-cent', [{ accountId: ids.aAccount, debit: 10.005, credit: 0 }, { accountId: ids.aSales, debit: 0, credit: 10.005 }]],
    ]
    for (const [description, lines] of cases) {
      const response = await bad(lines, description)
      expect(response.status, description).toBeGreaterThanOrEqual(400)
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.aCompany, description } }), description).toBe(0)
    }
  })

  it('allows negative amounts by design (overdraft), still requiring balance', async () => {
    // lib/accounting/validator.ts documents negative debit/credit as allowed;
    // this pins that intended policy so a future "reject negatives" change is a
    // conscious decision and does not regress silently.
    const response = await call('accountant', {
      route: routes.entries,
      method: 'POST',
      path: '/api/entries',
      body: {
        companyId: ids.aCompany,
        journalId: ids.aJournal,
        date: '2026-04-03',
        description: 'negative-ok',
        lines: [
          { accountId: ids.aAccount, debit: -100, credit: 0 },
          { accountId: ids.aSales, debit: 0, credit: -100 },
        ],
      },
    })
    expect(response.status).toBeLessThan(300)
  })

  it('never reconciles one transaction into two links', async () => {
    const first = await call('accountant', {
      route: routes.reconcile,
      method: 'POST',
      path: `/api/transactions/${ids.aTransaction}/reconcile`,
      params: { id: ids.aTransaction },
      body: { entryId: ids.aEntry },
    })
    expect(first.status).toBeLessThan(300)

    // A second reconcile to a different entry must not silently create a second link.
    await call('accountant', {
      route: routes.reconcile,
      method: 'POST',
      path: `/api/transactions/${ids.aTransaction}/reconcile`,
      params: { id: ids.aTransaction },
      body: { entryId: ids.aValidated },
    })

    const tx = await prisma.bankTransaction.findUnique({ where: { id: ids.aTransaction } })
    // Exactly one of the two entries is linked, never both, never a dangling duplicate.
    const linked = await prisma.bankTransaction.count({
      where: { id: ids.aTransaction, reconciledWith: { in: [ids.aEntry, ids.aValidated] } },
    })
    expect(tx?.reconciled).toBe(true)
    expect(linked).toBe(1)
  })

  it('guards result allocation on an open fiscal year', async () => {
    const response = await call('accountant', {
      route: routes.resultAllocation,
      method: 'POST',
      path: `/api/companies/${ids.aCompany}/fiscal-years/${ids.aFy}/result-allocation`,
      params: { id: ids.aCompany, fiscalYearId: ids.aFy },
      body: { date: '2026-06-30' },
    })
    // Allocation requires a closed year with a computed result: refused here.
    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})

// --- FEC import tampering (pure, always runs) ----------------------------

import { parseFecFile } from '@/lib/import/fec/parser'
import { planFecImport, type PlanContext } from '@/lib/import/fec/plan'

const FEC_HEADER =
  'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise'

const fecCtx = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  closingMonth: 12,
  closingDay: 31,
  foundationDay: null,
  fiscalYears: [],
  existingNumbers: new Map(),
  ...overrides,
})

const fecRow = (cols: Record<string, string>) => {
  const fields = FEC_HEADER.split('|')
  return fields.map((f) => cols[f] ?? '').join('|')
}

const fec = (...rows: string[]) => [FEC_HEADER, ...rows].join('\n')

describe('FEC import rejects tampered entries', () => {
  it('refuses an entry whose debit and credit do not balance', () => {
    const content = fec(
      fecRow({ JournalCode: 'VT', EcritureNum: '1', EcritureDate: '20260301', CompteNum: '512000', Debit: '100,00' }),
      fecRow({ JournalCode: 'VT', EcritureNum: '1', EcritureDate: '20260301', CompteNum: '706000', Credit: '99,99' }),
    )
    const plan = planFecImport(parseFecFile(content).lines, fecCtx())
    expect(plan.refused.length).toBeGreaterThan(0)
    expect(plan.refused[0]!.reason).toMatch(/quilibr/i)
    expect(plan.entries).toHaveLength(0)
  })

  it('refuses an entry with fewer than two amount lines', () => {
    const content = fec(
      fecRow({ JournalCode: 'OD', EcritureNum: '2', EcritureDate: '20260301', CompteNum: '512000', Debit: '100,00' }),
    )
    const plan = planFecImport(parseFecFile(content).lines, fecCtx())
    expect(plan.refused.length).toBeGreaterThan(0)
  })

  it('refuses an entry with a missing journal code', () => {
    const content = fec(
      fecRow({ EcritureNum: '3', EcritureDate: '20260301', CompteNum: '512000', Debit: '100,00' }),
      fecRow({ EcritureNum: '3', EcritureDate: '20260301', CompteNum: '706000', Credit: '100,00' }),
    )
    const plan = planFecImport(parseFecFile(content).lines, fecCtx())
    expect(plan.refused.length).toBeGreaterThan(0)
  })
})
