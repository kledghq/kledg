/**
 * Round 3 AUTHZ regressions (pentest round 3, fixed; the proofs of concept
 * of the review, turned around):
 *
 * - KLEDG-R3-AUTHZ-01: a company administrator cannot publish a balance sheet
 *   template to the other companies; another company never lists nor applies it.
 * - KLEDG-R3-AUTHZ-02: a list cursor of another company is refused (no
 *   existence or date oracle), for invoices and expense reports.
 * - KLEDG-R3-AUTHZ-03: a viewer of A cannot make their own company a subsidiary of A.
 * - KLEDG-R3-AUTHZ-04: the group export leaves out a subsidiary where the user
 *   may not export.
 * - KLEDG-R3-AUTHZ-07: the members read writes nothing.
 * - KLEDG-R3-AUTHZ-08: the group space checks in each subsidiary the right of
 *   the matching company page, and never names an outside shareholder
 *   company from the name stored on the shareholder row.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('r3_authz')
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

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const INVALID_CURSOR = 'Curseur invalide : rechargez la liste.'

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error?: string }).error ?? ''
}

describe.skipIf(!available)('round 3 AUTHZ regressions', () => {
  beforeEach(async () => {
    if (!prisma) ({ prisma } = await import('@/lib/prisma'))
    routes.invoices ??= (await import('@/app/api/invoices/route')) as unknown as Record<string, Handler>
    routes.expenseReports ??= (await import('@/app/api/expense-reports/route')) as unknown as Record<string, Handler>
    routes.shareholders ??= (await import('@/app/api/companies/[id]/shareholders/route')) as unknown as Record<string, Handler>
    routes.groupCompanies ??= (await import('@/app/api/group/companies/route')) as unknown as Record<string, Handler>
    routes.groupExport ??= (await import('@/app/api/group/export/route')) as unknown as Record<string, Handler>
    routes.members ??= (await import('@/app/api/companies/[id]/members/route')) as unknown as Record<string, Handler>
    routes.templates ??= (await import('@/app/api/companies/[id]/balance-sheet/config/templates/route')) as unknown as Record<string, Handler>
    await prepareTestDatabase('r3_authz')
    await seedTenants(prisma, ids)
    state.user = null
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  async function invoice(companyId: string, number: string, issueDate: string) {
    const tiers =
      (await prisma.tiers.findFirst({ where: { companyId, kind: 'CUSTOMER' } })) ??
      (await prisma.tiers.create({ data: { companyId, kind: 'CUSTOMER', name: 'Client', auxiliaryAccountNumber: 'C00001' } }))
    return prisma.invoice.create({
      data: { companyId, direction: 'SALE', tiersId: tiers.id, number, issueDate: day(issueDate), dueDate: day(issueDate), totalExclTax: 100, totalVat: 20, totalInclTax: 120 },
    })
  }

  async function expenseReport(companyId: string, number: string, periodEnd: string) {
    const claimant =
      (await prisma.expenseClaimant.findFirst({ where: { companyId } })) ??
      (await prisma.expenseClaimant.create({ data: { companyId, kind: 'EMPLOYEE', name: 'Salarié', auxiliaryAccountNumber: 'S00001' } }))
    return prisma.expenseReport.create({
      data: { companyId, claimantId: claimant.id, number, periodStart: day(periodEnd), periodEnd: day(periodEnd), totalInclTax: 12, recoverableVat: 2, totalExpense: 10 },
    })
  }

  it('[KLEDG-R3-AUTHZ-01] a company administrator publishes no template to the other companies', async () => {
    const published = await call('memberB', {
      route: routes.templates,
      method: 'POST',
      path: `/api/companies/${ids.bCompany}/balance-sheet/config/templates`,
      params: { id: ids.bCompany },
      body: { action: 'create', name: 'Modèle officiel DGFiP 2026', variant: 'complete', isPublic: true },
    })
    expect(published.status).toBe(400)
    // Saved for B only: A never lists nor applies it.
    const own = await call('memberB', {
      route: routes.templates,
      method: 'POST',
      path: `/api/companies/${ids.bCompany}/balance-sheet/config/templates`,
      params: { id: ids.bCompany },
      body: { action: 'create', name: 'Modèle de B', variant: 'complete' },
    })
    expect(own.status).toBe(201)
    const template = (await own.json()) as { id: string; companyId: string | null; isPublic: boolean }
    expect(template).toMatchObject({ companyId: ids.bCompany, isPublic: false })

    const listed = await call('viewer', {
      route: routes.templates,
      method: 'GET',
      path: `/api/companies/${ids.aCompany}/balance-sheet/config/templates?variant=complete`,
      params: { id: ids.aCompany },
    })
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as Array<{ id: string }>).map((t) => t.id)).not.toContain(template.id)
    const applied = await call('companyAdmin', {
      route: routes.templates,
      method: 'POST',
      path: `/api/companies/${ids.aCompany}/balance-sheet/config/templates`,
      params: { id: ids.aCompany },
      body: { action: 'apply', templateId: template.id },
    })
    expect(applied.status).toBe(404)
  })

  it('[KLEDG-R3-AUTHZ-02] an invoice id of another company is refused as a list cursor', async () => {
    for (let m = 1; m <= 12; m++) await invoice(ids.aCompany, `A-${m}`, `2026-${String(m).padStart(2, '0')}-15`)
    const secret = await invoice(ids.bCompany, 'B-SECRET', '2026-06-20')
    const list = (cursor: string) =>
      call('viewer', { route: routes.invoices, method: 'GET', path: `/api/invoices?companyId=${ids.aCompany}&direction=SALE&limit=50&cursor=${cursor}` })

    // Unknown and foreign ids answer alike.
    for (const cursor of ['does-not-exist', secret.id]) {
      const response = await list(cursor)
      expect(response.status).toBe(400)
      expect(await errorOf(response)).toBe(INVALID_CURSOR)
    }
    // A cursor of the company still pages.
    const first = await call('viewer', { route: routes.invoices, method: 'GET', path: `/api/invoices?companyId=${ids.aCompany}&direction=SALE&limit=5` })
    const page = (await first.json()) as { items: Array<{ number: string }>; nextCursor: string }
    expect(page.items.map((i) => i.number)).toEqual(['A-12', 'A-11', 'A-10', 'A-9', 'A-8'])
    const next = (await (await list(page.nextCursor)).json()) as { items: Array<{ number: string }> }
    expect(next.items.map((i) => i.number)).toEqual(['A-7', 'A-6', 'A-5', 'A-4', 'A-3', 'A-2', 'A-1'])
  })

  it('[KLEDG-R3-AUTHZ-02] an expense report id of another company is refused as a list cursor', async () => {
    await expenseReport(ids.aCompany, 'NDF-A-1', '2026-03-31')
    const secret = await expenseReport(ids.bCompany, 'NDF-B-1', '2026-04-30')
    const response = await call('accountant', {
      route: routes.expenseReports,
      method: 'GET',
      path: `/api/expense-reports?companyId=${ids.aCompany}&cursor=${secret.id}`,
    })
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toBe(INVALID_CURSOR)
  })

  it('[KLEDG-R3-AUTHZ-03] a viewer of A cannot make their own company a subsidiary of A', async () => {
    // memberB administers B and is only a viewer of A.
    await prisma.member.create({ data: { id: 'm-b-viewer-a', userId: 'u-member-b', organizationId: 'org-a', role: 'viewer', createdAt: new Date() } })
    const linked = await call('memberB', {
      route: routes.shareholders,
      method: 'POST',
      path: `/api/companies/${ids.bCompany}/shareholders`,
      params: { id: ids.bCompany },
      body: { type: 'LEGAL', companyShareholderId: ids.aCompany, sharePercentage: 60 },
    })
    expect(linked.status).toBe(403)
    const group = await call('companyAdmin', { route: routes.groupCompanies, method: 'GET', path: `/api/group/companies?companyId=${ids.aCompany}` })
    expect(((await group.json()) as { unreachable: unknown[] }).unreachable).toEqual([])

    // An administrator of both companies may.
    await prisma.member.update({ where: { id: 'm-b-viewer-a' }, data: { role: 'companyAdmin' } })
    const allowed = await call('memberB', {
      route: routes.shareholders,
      method: 'POST',
      path: `/api/companies/${ids.bCompany}/shareholders`,
      params: { id: ids.bCompany },
      body: { type: 'LEGAL', companyShareholderId: ids.aCompany, sharePercentage: 60 },
    })
    expect(allowed.status).toBe(201)
  })

  it('[KLEDG-R3-AUTHZ-04] the group export leaves out a subsidiary where the user is only a viewer', async () => {
    await prisma.shareholder.create({ data: { companyId: ids.bCompany, type: 'LEGAL', name: 'Atelier Alpha', companyShareholderId: ids.aCompany, sharePercentage: 100 } })
    await prisma.member.create({ data: { id: 'm-cadmin-b', userId: 'u-cadmin', organizationId: 'org-b', role: 'viewer', createdAt: new Date() } })
    await prisma.bankTransaction.create({
      data: { bankAccountId: ids.bBankAccount, externalTransactionId: 'tx-b-secret', amount: -4321, date: day('2026-04-02'), side: 'debit', label: 'B-CONFIDENTIAL-PAYEE' },
    })
    const exported = () =>
      call('companyAdmin', { route: routes.groupExport, method: 'GET', path: `/api/group/export?companyId=${ids.aCompany}&report=transactions&format=csv` })

    const refused = await exported()
    expect(refused.status).toBe(200)
    const text = await refused.text()
    expect(text).not.toContain('B-CONFIDENTIAL-PAYEE')
    expect(text).toContain('1 filiale n’est pas exportée, faute d’accès ou de droit d’export.')
    // Still visible in the group pages (reports:read).
    const pages = await call('companyAdmin', { route: routes.groupCompanies, method: 'GET', path: `/api/group/companies?companyId=${ids.aCompany}` })
    expect(((await pages.json()) as { unreachable: unknown[] }).unreachable).toEqual([])

    // As accountant of B (reports:export there), B's rows are in the file.
    await prisma.member.update({ where: { id: 'm-cadmin-b' }, data: { role: 'accountant' } })
    expect(await (await exported()).text()).toContain('B-CONFIDENTIAL-PAYEE')
  })

  it('[KLEDG-R3-AUTHZ-07] reading the members of a company without organization creates none', async () => {
    const bare = await prisma.company.create({ data: { name: 'Sans organisation', slug: 'sans-organisation', siren: '444444444' } })
    const response = await call('admin', { route: routes.members, method: 'GET', path: `/api/companies/${bare.id}/members`, params: { id: bare.id } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(await prisma.organization.count({ where: { companyId: bare.id } })).toBe(0)
  })

  /**
   * A role that reads the statements of B but neither its bank nor its entries
   * (no such role today; an assistant's scope or a future reporting role):
   * the access answers like requireCompanyPermission.
   */
  async function reportingOnlyInB(): Promise<import('@/lib/management-fees/access').GroupAccess> {
    const { ForbiddenError } = await import('@/lib/accounting/errors')
    await prisma.shareholder.create({ data: { companyId: ids.bCompany, type: 'LEGAL', name: 'Atelier Alpha', companyShareholderId: ids.aCompany, sharePercentage: 100 } })
    await prisma.member.create({ data: { id: 'm-cadmin-b', userId: 'u-cadmin', organizationId: 'org-b', role: 'viewer', createdAt: new Date() } })
    return {
      userId: 'u-cadmin',
      async require(companyId, permission) {
        if (companyId === ids.bCompany && ('banking' in permission || 'entries' in permission)) throw new ForbiddenError('Action non autorisée')
      },
    }
  }

  it('[KLEDG-R3-AUTHZ-08] bank data and ledger lines of a subsidiary need banking:read and entries:read there', async () => {
    const access = await reportingOnlyInB()
    await prisma.bankTransaction.create({
      data: { bankAccountId: ids.bBankAccount, externalTransactionId: 'tx-b-group', amount: -12, date: day('2026-04-02'), side: 'debit', label: 'B-BANK-ONLY' },
    })
    const { listGroupTransactions } = await import('@/lib/group/list-group-transactions.service')
    const { getGroupTreasury } = await import('@/lib/group/get-group-treasury.service')
    const { getGroupLedger } = await import('@/lib/group/get-group-ledger.service')
    const { getGroupCompanies } = await import('@/lib/group/get-group-companies.service')

    const transactions = await listGroupTransactions(ids.aCompany, {}, access)
    expect(transactions.items.some((t) => t.companyId === ids.bCompany)).toBe(false)
    expect(transactions.unreachable).toEqual([{ name: 'Bureau Beta', reason: 'role' }])
    const treasury = await getGroupTreasury(ids.aCompany, {}, access)
    expect(treasury.companies.map((c) => c.company.id)).toEqual([ids.aCompany])
    // Balances: the statements right is enough, like the company's Grand livre; the lines of an account are not.
    const balances = await getGroupLedger(ids.aCompany, {}, access)
    expect(balances.companies.map((c) => c.id).sort()).toEqual([ids.aCompany, ids.bCompany].sort())
    const lines = await getGroupLedger(ids.aCompany, { account: '512000' }, access)
    expect(lines.companies.map((c) => c.id)).toEqual([ids.aCompany])
    // A view of the statements still reads B.
    const companies = await getGroupCompanies(ids.aCompany, {}, access)
    expect(companies.unreachable).toEqual([])
  })

  it('[KLEDG-R3-AUTHZ-08] an outside shareholder company the user cannot read is not named from the stored row', async () => {
    const { userGroupAccess } = await import('@/lib/management-fees/access')
    const outside = await prisma.company.create({ data: { name: 'Holding Secrète', slug: 'holding-secrete', siren: '555555555' } })
    await prisma.shareholder.create({ data: { companyId: ids.aCompany, type: 'LEGAL', name: 'Holding Secrète (nom enregistré)', companyShareholderId: outside.id, sharePercentage: 40 } })
    const { getGroupPersons } = await import('@/lib/group/get-group-persons.service')
    const { getGroupStructure } = await import('@/lib/group/get-group-structure.service')
    const access = userGroupAccess({ id: 'u-cadmin', email: 'cadmin@sec.local', name: null, role: 'user' })

    const persons = await getGroupPersons(ids.aCompany, access)
    const text = JSON.stringify(persons)
    expect(text).not.toContain('Holding Secrète')
    expect(persons.holders.some((h) => h.kind === 'company' && h.name === 'Société actionnaire')).toBe(true)
    expect(JSON.stringify(await getGroupStructure(ids.aCompany, access))).not.toContain('Holding Secrète')

    // A member of that company sees its name.
    await prisma.organization.create({ data: { id: 'org-outside', name: 'Holding Secrète', slug: 'org-holding-secrete', createdAt: new Date(), companyId: outside.id } })
    await prisma.member.create({ data: { id: 'm-cadmin-outside', userId: 'u-cadmin', organizationId: 'org-outside', role: 'viewer', createdAt: new Date() } })
    const named = await getGroupPersons(ids.aCompany, access)
    expect(named.holders.some((h) => h.name === 'Holding Secrète')).toBe(true)
  })
})
