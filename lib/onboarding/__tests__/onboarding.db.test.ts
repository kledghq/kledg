/**
 * Onboarding against PostgreSQL (lib/__tests__/helpers/test-db.ts), through
 * the real route handlers with only the session mocked:
 * - company creation wizard: the company, its first fiscal year, chart of
 *   accounts, journals, head office and shareholders; SIREN conflicts;
 *   instance administrators only; the SIREN lookup never blocks;
 * - "Démarrer" checklist: steps detected from the company's data;
 * - dismissal persisted per company, by members who keep the books;
 * - opening balances: one balanced AN entry on the first day of the first
 *   fiscal year, refused twice;
 * - viewers cannot write (403), non-members get 404, anonymous users 401.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('onboarding')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { CreateCompanyInput } from '@/lib/companies/company-wizard'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
const routes: Record<string, Record<string, Handler>> = {}

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

async function call(
  who: Who,
  route: string,
  method: 'GET' | 'POST',
  path: string,
  options: { params?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return routes[route][method](request, { params: Promise.resolve(options.params ?? {}) })
}

/** An existing company (created in 2015) that starts its books in Kledg with the 2026 exercice. */
const existingCompany: CreateCompanyInput = {
  name: 'SCI Les Tilleuls',
  siren: '912 345 675',
  legalType: 'SCI',
  activityCode: '68.20B',
  foundationDate: '2015-06-01',
  headOffice: { siret: '91234567500012', street: '12 BIS RUE DES ARTISANS', postalCode: '69007', city: 'LYON' },
  firstFiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31', isFirst: false },
  vatRegime: 'franchise',
  corporateTaxRegime: null,
  totalShares: 1000,
  shareNominalValueCents: 1000,
  shareholders: [
    { type: 'PHYSICAL', firstName: 'Claire', name: 'Martin', numberOfShares: 600 },
    { type: 'LEGAL', name: 'Lumen Holding', numberOfShares: 400 },
  ],
}

/** A company created this year: its first exercice starts on its creation date. */
const newCompany: CreateCompanyInput = {
  name: 'Atelier Lumen',
  siren: '912345683',
  legalType: 'SASU',
  firstFiscalYear: { startDate: '2026-03-14', endDate: '2027-06-30', isFirst: true },
  vatRegime: 'simplified',
  corporateTaxRegime: 'simplified',
}

const ids = {} as Record<string, string>

describe.skipIf(!available)('onboarding', () => {
  beforeAll(async () => {
    await prepareTestDatabase('onboarding')
    ;({ prisma } = await import('@/lib/prisma'))
    routes.companies = (await import('@/app/api/companies/route')) as unknown as Record<string, Handler>
    routes.lookup = (await import('@/app/api/companies/lookup/route')) as unknown as Record<string, Handler>
    routes.onboarding = (await import('@/app/api/companies/[id]/onboarding/route')) as unknown as Record<string, Handler>
    routes.opening = (await import('@/app/api/companies/[id]/opening-balances/route')) as unknown as Record<string, Handler>
    routes.journals = (await import('@/app/api/journals/route')) as unknown as Record<string, Handler>
    for (const user of Object.values(USERS)) {
      await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
    }
    // Company B and its member, to check that A stays invisible to them
    const b = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222' } })
    await prisma.organization.create({ data: { id: 'org-b', name: 'Bureau Beta', slug: 'org-bureau-beta', createdAt: new Date(), companyId: b.id } })
    await prisma.member.create({ data: { id: 'm-b', userId: USERS.memberB.id, organizationId: 'org-b', role: 'companyAdmin', createdAt: new Date() } })
  }, 120_000)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('company creation', () => {
    it('is reserved to instance administrators', async () => {
      expect((await call('anonymous', 'companies', 'POST', '/api/companies', { body: existingCompany })).status).toBe(401)
      expect((await call('viewer', 'companies', 'POST', '/api/companies', { body: existingCompany })).status).toBe(403)
      expect(await prisma.company.count({ where: { siren: '912345675' } })).toBe(0)
    })

    it('refuses an invalid wizard with the French reasons', async () => {
      const response = await call('admin', 'companies', 'POST', '/api/companies', {
        body: { ...existingCompany, firstFiscalYear: { startDate: '2026-01-01', endDate: '2028-06-30', isFirst: true } },
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toMatch(/24 mois/)
    })

    it('creates the company with its first fiscal year, chart of accounts, journals, head office and shareholders', async () => {
      const response = await call('admin', 'companies', 'POST', '/api/companies', { body: existingCompany })
      expect(response.status).toBe(201)
      const created = (await response.json()) as { id: string; slug: string; fiscalYearId: string }
      ids.a = created.id
      ids.aSlug = created.slug
      ids.aFy = created.fiscalYearId

      const company = await prisma.company.findUniqueOrThrow({ where: { id: created.id } })
      expect(company).toMatchObject({ name: 'SCI Les Tilleuls', siren: '912345675', legalType: 'SCI', vatRegime: 'franchise', corporateTaxRegime: null, closingDay: 31, closingMonth: 12 })
      expect(company.shareCapital?.toString()).toBe('10000')
      const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: created.fiscalYearId } })
      expect(fy.year).toBe(2026)
      expect(fy.startDate.toISOString().slice(0, 10)).toBe('2026-01-01')
      expect(fy.endDate.toISOString().slice(0, 10)).toBe('2026-12-31')
      expect(await prisma.account.count({ where: { fiscalYearId: fy.id } })).toBeGreaterThan(100)
      expect((await prisma.journal.findMany({ where: { companyId: created.id } })).map((j) => j.code).sort()).toEqual(['AC', 'AN', 'BQ', 'OD', 'VE'])
      expect(await prisma.organization.count({ where: { companyId: created.id } })).toBe(1)
      const office = await prisma.establishment.findFirstOrThrow({ where: { companyId: created.id }, include: { address: true } })
      expect(office).toMatchObject({ siret: '91234567500012', isMain: true, address: { city: 'LYON', postalCode: '69007' } })
      const holders = await prisma.shareholder.findMany({ where: { companyId: created.id }, include: { person: true }, orderBy: { numberOfShares: 'desc' } })
      expect(holders.map((h) => [h.type, h.sharePercentage.toString(), h.person?.firstName ?? h.name])).toEqual([
        ['PHYSICAL', '60', 'Claire'],
        ['LEGAL', '40', 'Lumen Holding'],
      ])

      // Regression: listing the journals used to upsert another default set
      // (VT, CA), so the new company showed 7 journals, two named "Ventes".
      const listed = await call('admin', 'journals', 'GET', `/api/journals?companyId=${created.id}`)
      expect(listed.status).toBe(200)
      expect(((await listed.json()) as Array<{ code: string }>).map((j) => j.code)).toEqual(['AC', 'AN', 'BQ', 'OD', 'VE'])
      expect(await prisma.journal.count({ where: { companyId: created.id } })).toBe(5)

      // Members of A for the next tests
      await prisma.member.createMany({
        data: [
          { id: 'm-acc', userId: USERS.accountant.id, organizationId: created.id, role: 'accountant', createdAt: new Date() },
          { id: 'm-view', userId: USERS.viewer.id, organizationId: created.id, role: 'viewer', createdAt: new Date() },
        ],
      })
    })

    it('refuses a second company with the same SIREN', async () => {
      const response = await call('admin', 'companies', 'POST', '/api/companies', { body: { ...existingCompany, headOffice: null } })
      expect(response.status).toBe(409)
      expect(((await response.json()) as { error: string }).error).toMatch(/912345675/)
    })

    it('creates a new company whose first exercice starts on its creation date', async () => {
      const response = await call('admin', 'companies', 'POST', '/api/companies', { body: newCompany })
      expect(response.status).toBe(201)
      const created = (await response.json()) as { id: string; slug: string }
      ids.n = created.id
      ids.nSlug = created.slug
      const company = await prisma.company.findUniqueOrThrow({ where: { id: created.id } })
      expect(company.foundationDate?.toISOString().slice(0, 10)).toBe('2026-03-14')
      expect(company).toMatchObject({ legalType: 'SASU', closingDay: 30, closingMonth: 6 })
      const fy = await prisma.fiscalYear.findFirstOrThrow({ where: { companyId: created.id } })
      expect(fy.year).toBe(2027)
    })
  })

  describe('SIREN lookup', () => {
    it('is reserved to instance administrators and answers "unavailable" when the directory is down', async () => {
      const fetchMock = vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
      vi.stubGlobal('fetch', fetchMock)
      expect((await call('viewer', 'lookup', 'GET', '/api/companies/lookup?siren=912345675')).status).toBe(403)
      const response = await call('admin', 'lookup', 'GET', '/api/companies/lookup?siren=912345675')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'unavailable' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect((await call('admin', 'lookup', 'GET', '/api/companies/lookup?siren=12')).status).toBe(400)
    })
  })

  describe('checklist', () => {
    const get = async (who: Who, company = ids.a) => call(who, 'onboarding', 'GET', `/api/companies/${company}/onboarding`, { params: { id: company } })
    type View = { enabled: boolean; dismissed: boolean; canManage: boolean; done: number; total: number; steps: Array<{ id: string; done: boolean; detail: string | null; action: { href: string } | null }> }
    const stepOf = (view: View, id: string) => view.steps.find((s) => s.id === id)

    it('detects the steps from the company data', async () => {
      const response = await get('viewer')
      expect(response.status).toBe(200)
      const view = (await response.json()) as View
      expect(view).toMatchObject({ enabled: true, dismissed: false, canManage: false })
      expect(view.steps.map((s) => s.id)).toEqual(['chart', 'bank', 'history', 'rule', 'accountant', 'assistant'])
      expect(stepOf(view, 'chart')?.done).toBe(true)
      expect(stepOf(view, 'bank')?.done).toBe(false)
      expect(stepOf(view, 'history')?.done).toBe(false)
      expect(stepOf(view, 'rule')?.done).toBe(false)
      expect(stepOf(view, 'accountant')).toMatchObject({ done: true, detail: '1 membre avec le rôle Comptable', action: null })
      // The viewer, a second member, is not counted as an accountant
      expect(stepOf(view, 'accountant')?.detail).not.toMatch(/2 membres/)
      expect(stepOf(view, 'assistant')?.done).toBe(false)
      expect(view.done).toBe(2)
    })

    it('has no history step for a company created with its first exercice', async () => {
      const view = (await (await get('admin', ids.n)).json()) as View
      expect(view.steps.map((s) => s.id)).not.toContain('history')
      // The instance administrator manages members: the step has a button
      expect(stepOf(view, 'accountant')?.action?.href).toBe(`/${ids.nSlug}/members`)
    })

    it('counts only members with the Comptable role as the invited accountant', async () => {
      const accountantStep = async () => stepOf((await (await get('admin', ids.n)).json()) as View, 'accountant')
      await prisma.member.create({ data: { id: 'm-n-view', userId: USERS.viewer.id, organizationId: ids.n, role: 'viewer', createdAt: new Date() } })
      expect((await accountantStep())?.done).toBe(false)
      // Several roles on one member row ("companyAdmin,accountant")
      await prisma.member.create({
        data: { id: 'm-n-acc', userId: USERS.accountant.id, organizationId: ids.n, role: 'companyAdmin,accountant', createdAt: new Date() },
      })
      expect(await accountantStep()).toMatchObject({ done: true, detail: '1 membre avec le rôle Comptable' })
      await prisma.member.deleteMany({ where: { id: { in: ['m-n-view', 'm-n-acc'] } } })
    })

    it('sees imported bank operations and suggests a rule from frequent labels', async () => {
      const connection = await prisma.bankConnection.create({ data: { companyId: ids.a, provider: 'MANUAL' } })
      const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'manual-1', name: 'Compte courant' } })
      for (const [n, label] of ['PRLV SEPA OVH SAS 12/07', 'PRLV SEPA OVH SAS 12/08', 'PRLV SEPA OVH SAS 12/09', 'VIR CLIENT DUPONT'].entries()) {
        await prisma.bankTransaction.create({
          data: { bankAccountId: account.id, externalTransactionId: `tx-${n}`, amount: -12.99, date: new Date(Date.UTC(2026, 6 + n, 12)), side: 'debit', label },
        })
      }
      const view = (await (await get('accountant')).json()) as View
      expect(view.canManage).toBe(true)
      expect(stepOf(view, 'bank')).toMatchObject({ done: true, detail: '4 opérations reçues' })
      expect(stepOf(view, 'rule')?.detail).toBe('Libellés fréquents : OVH SAS (3 fois)')
      expect(stepOf(view, 'rule')?.action?.href).toMatch(new RegExp(`^/${ids.aSlug}/rules\\?fromTransaction=`))
    })

    it('counts an AI connection only when it may reach the company', async () => {
      const now = new Date()
      await prisma.apikey.create({
        data: { id: 'key-1', referenceId: USERS.accountant.id, key: 'hashed', createdAt: now, updatedAt: now, name: 'Claude' },
      })
      expect(stepOf((await (await get('accountant')).json()) as View, 'assistant')?.done).toBe(true)
      // Restricted to company B only: no longer reaches A
      await prisma.aiAccessGrant.create({ data: { userId: USERS.accountant.id, apiKeyId: 'key-1', allCompanies: false } })
      expect(stepOf((await (await get('accountant')).json()) as View, 'assistant')?.done).toBe(false)
      await prisma.aiAccessGrantCompany.create({ data: { grantId: (await prisma.aiAccessGrant.findFirstOrThrow()).id, companyId: ids.a } })
      expect(stepOf((await (await get('accountant')).json()) as View, 'assistant')?.done).toBe(true)
    })

    it('answers 404 to non-members and 401 to anonymous users', async () => {
      expect((await get('memberB')).status).toBe(404)
      expect((await get('anonymous')).status).toBe(401)
    })

    it('is hidden and shown again per company, by members who keep the books', async () => {
      const post = (who: Who, action: string) =>
        call(who, 'onboarding', 'POST', `/api/companies/${ids.a}/onboarding`, { params: { id: ids.a }, body: { action } })
      expect((await post('viewer', 'dismiss')).status).toBe(403)
      expect((await post('memberB', 'dismiss')).status).toBe(404)
      const unknown = await post('accountant', 'archive')
      expect(unknown.status).toBe(400)
      expect(((await unknown.json()) as { error: string }).error).toBe('action: Action inconnue : dismiss ou reopen')
      const dismissed = await post('accountant', 'dismiss')
      expect(dismissed.status).toBe(200)
      expect(await dismissed.json()).toEqual({ dismissed: true })
      expect(((await (await get('viewer')).json()) as View).dismissed).toBe(true)
      // Per company: the other company still shows it
      expect(((await (await get('admin', ids.n)).json()) as View).dismissed).toBe(false)
      const row = await prisma.companyOnboarding.findUniqueOrThrow({ where: { companyId: ids.a } })
      expect(row.dismissedById).toBe(USERS.accountant.id)
      expect((await post('admin', 'reopen')).status).toBe(200)
      expect(((await (await get('viewer')).json()) as View).dismissed).toBe(false)
    })
  })

  describe('opening balances', () => {
    const lines = [
      { accountCode: '512', debitCents: 1_500_000, creditCents: 0 },
      { accountCode: '411', debitCents: 20_050, creditCents: 0 },
      { accountCode: '1013', debitCents: 0, creditCents: 1_000_000 },
      { accountCode: '120', debitCents: 0, creditCents: 520_050 },
    ]
    const post = (who: Who, body: unknown) =>
      call(who, 'opening', 'POST', `/api/companies/${ids.a}/opening-balances`, { params: { id: ids.a }, body })

    it('refuses viewers, non-members and anonymous users', async () => {
      expect((await post('viewer', { lines })).status).toBe(403)
      expect((await post('memberB', { lines })).status).toBe(404)
      expect((await post('anonymous', { lines })).status).toBe(401)
    })

    it('refuses an unbalanced entry or an income statement account, and books nothing', async () => {
      const unbalanced = await post('accountant', { lines: [...lines.slice(0, 3), { accountCode: '120', debitCents: 0, creditCents: 520_049 }] })
      expect(unbalanced.status).toBe(400)
      expect(((await unbalanced.json()) as { error: string }).error).toMatch(/équilibré/)
      const income = await post('accountant', {
        lines: [{ accountCode: '512', debitCents: 100, creditCents: 0 }, { accountCode: '706', debitCents: 0, creditCents: 100 }],
      })
      expect(income.status).toBe(400)
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.a } })).toBe(0)
    })

    it('books one balanced AN entry on the first day of the first fiscal year', async () => {
      const response = await post('accountant', { lines })
      expect(response.status).toBe(201)
      const entry = await prisma.accountingEntry.findFirstOrThrow({
        where: { companyId: ids.a },
        include: { journal: true, lines: { include: { account: true } } },
      })
      expect(entry.journal.code).toBe('AN')
      expect(entry.fiscalYearId).toBe(ids.aFy)
      expect(entry.date.toISOString().slice(0, 10)).toBe('2026-01-01')
      expect(entry.status).toBe('draft')
      expect(entry.reference).toBe('AN-2026')
      const debit = entry.lines.reduce((sum, l) => sum + Math.round(Number(l.debit) * 100), 0)
      const credit = entry.lines.reduce((sum, l) => sum + Math.round(Number(l.credit) * 100), 0)
      expect(debit).toBe(1_520_050)
      expect(credit).toBe(1_520_050)
      expect(entry.lines.every((l) => l.account.fiscalYearId === ids.aFy)).toBe(true)

      // The checklist sees it
      const view = (await (await call('viewer', 'onboarding', 'GET', `/api/companies/${ids.a}/onboarding`, { params: { id: ids.a } })).json()) as {
        steps: Array<{ id: string; done: boolean }>
      }
      expect(view.steps.find((s) => s.id === 'history')?.done).toBe(true)
    })

    it('refuses a second opening entry in the same fiscal year', async () => {
      const response = await post('accountant', { lines })
      expect(response.status).toBe(409)
      expect(await prisma.accountingEntry.count({ where: { companyId: ids.a, journal: { code: 'AN' } } })).toBe(1)
    })

    it('validates the entry on request, with its definitive number', async () => {
      await prisma.accountingEntry.deleteMany({ where: { companyId: ids.a, status: 'draft' } })
      const response = await post('accountant', { lines, validate: true })
      expect(response.status).toBe(201)
      const entry = (await response.json()) as { status: string; entryNumber: string }
      expect(entry.status).toBe('validated')
      expect(entry.entryNumber).not.toMatch(/^BR-/)
    })

    it('tells where the opening balances go', async () => {
      const response = await call('viewer', 'opening', 'GET', `/api/companies/${ids.a}/opening-balances`, { params: { id: ids.a } })
      const { target } = (await response.json()) as { target: { fiscalYear: { year: number; startDate: string }; existingEntry: { status: string } } }
      expect(target.fiscalYear).toMatchObject({ year: 2026, startDate: '2026-01-01' })
      expect(target.existingEntry.status).toBe('validated')
    })
  })
})
