/**
 * Fixed asset routes against PostgreSQL (session and roles mocked): the
 * register, its totals, depreciation records and their booking as a
 * validated OD entry (debit 6811, credit 28, PCG art. 214-13). Input is
 * validated with French messages; another company's asset is a 404.
 * Skipped without the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ids = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('fixed_asset_routes')
  return {} as Record<string, string>
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  // Member of the seeded company only: another company is a 404.
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === ids.company ? ['companyAdmin'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Routes = Record<string, Handler>
let prisma: typeof import('@/lib/prisma').prisma
const routes = {} as Record<'assets' | 'asset' | 'stats' | 'status' | 'records' | 'record' | 'candidates' | 'post', Routes>

function call(handler: Handler, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, params ? { params: Promise.resolve(params) } : undefined)
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
  // The mocked session user is a member in the database too (row level security).
  await seedMembership(prisma, 'user-1', company.id)
  const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') },
  })
  const otherFy = await prisma.fiscalYear.create({
    data: { companyId: other.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') },
  })
  const account = (code: string, label: string) =>
    prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
  const asset = await account('218300', 'Matériel informatique')
  const depreciation = await account('281830', 'Amortissements du matériel informatique')
  const expense = await account('681120', 'Dotations aux amortissements')
  const otherAccount = await prisma.account.create({ data: { companyId: other.id, fiscalYearId: otherFy.id, code: '218300', label: 'Autre' } })
  const otherAsset = await prisma.fixedAsset.create({
    data: {
      companyId: other.id,
      label: 'Autre',
      acquisitionDate: day('2025-01-01'),
      acquisitionValue: 100,
      depreciationStartDate: day('2025-01-01'),
      depreciationDuration: 1,
      assetAccountId: otherAccount.id,
      depreciationAccountId: otherAccount.id,
      expenseAccountId: otherAccount.id,
    },
  })
  Object.assign(ids, {
    company: company.id,
    fy: fy.id,
    otherFy: otherFy.id,
    asset: asset.id,
    depreciation: depreciation.id,
    expense: expense.id,
    otherAccount: otherAccount.id,
    otherAsset: otherAsset.id,
  })
}

describe.skipIf(!available)('fixed asset routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('fixed_asset_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    const load = async (path: Promise<unknown>) => (await path) as Routes
    Object.assign(routes, {
      assets: await load(import('@/app/api/fixed-assets/route')),
      asset: await load(import('@/app/api/fixed-assets/[id]/route')),
      stats: await load(import('@/app/api/fixed-assets/stats/route')),
      status: await load(import('@/app/api/fixed-assets/[id]/depreciation-status/route')),
      records: await load(import('@/app/api/fixed-assets/[id]/depreciation/route')),
      record: await load(import('@/app/api/fixed-assets/[id]/depreciation/[entryId]/route')),
      candidates: await load(import('@/app/api/fixed-assets/[id]/depreciation/[entryId]/candidates/route')),
      post: await load(import('@/app/api/fixed-assets/[id]/depreciation/[entryId]/post/route')),
    })
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const newAsset = () => ({
    companyId: ids.company,
    label: 'Ordinateur',
    acquisitionDate: '2025-03-15',
    acquisitionValue: 1200,
    depreciationMethod: 'linear',
    depreciationDuration: 3,
    depreciationStartDate: '2025-03-15',
    assetAccountId: ids.asset,
    depreciationAccountId: ids.depreciation,
    expenseAccountId: ids.expense,
    isFullyPaid: true,
  })

  it('creates, lists, reads and updates a fixed asset', async () => {
    const created = await call(routes.assets.POST, 'POST', '/api/fixed-assets', newAsset())
    expect(created.status).toBe(201)
    const asset = (await created.json()) as { id: string; acquisitionValue: string; assetAccount: { code: string } }
    expect(asset.acquisitionValue).toBe('1200')
    expect(asset.assetAccount.code).toBe('218300')
    ids.fixedAsset = asset.id

    const list = (await (await call(routes.assets.GET, 'GET', `/api/fixed-assets?companyId=${ids.company}`)).json()) as Array<{ id: string }>
    expect(list.map((a) => a.id)).toEqual([asset.id])

    const read = await call(routes.asset.GET, 'GET', `/api/fixed-assets/${asset.id}`, undefined, { id: asset.id })
    expect(read.status).toBe(200)

    const updated = await call(
      routes.asset.PATCH,
      'PATCH',
      `/api/fixed-assets/${asset.id}`,
      { companyId: ids.company, comment: 'Poste 3', amortizableAmount: '1000.50', depreciationDuration: '4' },
      { id: asset.id },
    )
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ comment: 'Poste 3', amortizableAmount: '1000.5', depreciationDuration: 4, label: 'Ordinateur' })
  })

  it('refuses invalid fixed asset input with French messages', async () => {
    const missing = await call(routes.assets.POST, 'POST', '/api/fixed-assets', { companyId: ids.company, label: 'x' })
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toMatch(/^Champs obligatoires manquants/)

    const wrongType = await call(routes.assets.POST, 'POST', '/api/fixed-assets', { ...newAsset(), label: 12 })
    expect(wrongType.status).toBe(400)
    expect((await wrongType.json()).error).toBe('label: Libellé invalide')

    const badAmount = await call(
      routes.asset.PATCH,
      'PATCH',
      `/api/fixed-assets/${ids.fixedAsset}`,
      { acquisitionValue: '12,345' },
      { id: ids.fixedAsset },
    )
    expect(badAmount.status).toBe(400)
    expect((await badAmount.json()).error).toBe("Valeur d'acquisition : montant invalide (deux décimales au plus)")

    const badMethod = await call(routes.asset.PATCH, 'PATCH', `/api/fixed-assets/${ids.fixedAsset}`, { depreciationMethod: 'fast' }, { id: ids.fixedAsset })
    expect(badMethod.status).toBe(400)

    const foreignAccount = await call(
      routes.asset.PATCH,
      'PATCH',
      `/api/fixed-assets/${ids.fixedAsset}`,
      { assetAccountId: ids.otherAccount },
      { id: ids.fixedAsset },
    )
    expect(foreignAccount.status).toBe(404)
  })

  it('records depreciation, replaces it, and refuses invalid periods', async () => {
    const path = `/api/fixed-assets/${ids.fixedAsset}/depreciation`
    const params = { id: ids.fixedAsset }

    // Without amount: the plan's amount for March 2025 (17 days of 1000.50 / 4 years).
    const suggested = await call(routes.records.POST, 'POST', path, { companyId: ids.company, fiscalYearId: ids.fy, periodType: 'month', monthIndex: 2 }, params)
    expect(suggested.status).toBe(201)
    const march = (await suggested.json()) as { id: string; amount: string; year: number; monthIndex: number }
    expect(march).toMatchObject({ year: 2025, monthIndex: 2 })
    expect(Number(march.amount)).toBeGreaterThan(0)

    const yearly = await call(routes.records.POST, 'POST', path, { fiscalYearId: ids.fy, periodType: 'year', amount: 200.1 }, params)
    expect(yearly.status).toBe(201)
    const record = (await yearly.json()) as { id: string; amount: string }
    expect(record.amount).toBe('200.1')

    // Same period again: the record is replaced, not duplicated.
    const replaced = await call(routes.records.POST, 'POST', path, { fiscalYearId: ids.fy, periodType: 'year', amount: 200.123 }, params)
    expect(((await replaced.json()) as { id: string; amount: string })).toMatchObject({ id: record.id, amount: '200.12' })
    ids.record = record.id

    const cases: Array<[unknown, number, string | RegExp]> = [
      [{ periodType: 'year' }, 400, /^fiscalYearId: Choisissez l'exercice/],
      [{ fiscalYearId: ids.fy, periodType: 'week' }, 400, /^periodType: Type de période invalide/],
      [{ fiscalYearId: ids.fy, periodType: 'month' }, 400, "Indiquez le mois (0 à 11) d'un amortissement mensuel"],
      [{ fiscalYearId: ids.fy, periodType: 'year', amount: -5 }, 400, 'Montant négatif'],
      [{ fiscalYearId: ids.otherFy, periodType: 'year' }, 404, 'Exercice fiscal introuvable'],
    ]
    for (const [body, status, message] of cases) {
      const response = await call(routes.records.POST, 'POST', path, body, params)
      expect(response.status, JSON.stringify(body)).toBe(status)
      expect((await response.json()).error).toMatch(message)
    }
  })

  it('reports the depreciation status and the totals in cents', async () => {
    const status = await call(routes.status.GET, 'GET', `/api/fixed-assets/${ids.fixedAsset}/depreciation-status`, undefined, { id: ids.fixedAsset })
    expect(status.status).toBe(200)
    const body = (await status.json()) as { baseAmount: number; totalPosted: number; fiscalYears: Array<{ year: number; virtual: boolean; postedAmount: number }> }
    expect(body.baseAmount).toBe(1000.5)
    expect(body.fiscalYears[0]).toMatchObject({ year: 2025, virtual: false })
    expect(body.fiscalYears.slice(1).every((y) => y.virtual)).toBe(true)
    expect(body.fiscalYears[0].postedAmount).toBe(body.totalPosted)

    const stats = await (await call(routes.stats.GET, 'GET', `/api/fixed-assets/stats?companyId=${ids.company}`)).json()
    expect(stats).toEqual({ totalAssets: 1200, previousDepreciation: 0, currentDepreciation: body.totalPosted })
  })

  it('books a record as a validated OD entry once, then lists it as a link candidate', async () => {
    const params = { id: ids.fixedAsset, entryId: ids.record }
    const posted = await call(routes.post.POST, 'POST', `/api/fixed-assets/${ids.fixedAsset}/depreciation/${ids.record}/post`, { companyId: ids.company }, params)
    expect(posted.status).toBe(200)
    const { accountingEntry } = (await posted.json()) as { accountingEntry: { id: string; date: string } }
    expect(accountingEntry.date).toBe('2025-12-31T00:00:00.000Z')
    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: accountingEntry.id },
      include: { journal: true, lines: { include: { account: true } } },
    })
    expect(entry.status).toBe('validated')
    expect(entry.journal.code).toBe('OD')
    expect(entry.lines.map((l) => [l.account.code, l.debit.toString(), l.credit.toString()])).toEqual([
      ['681120', '200.12', '0'],
      ['281830', '0', '200.12'],
    ])

    const again = await call(routes.post.POST, 'POST', `/api/fixed-assets/${ids.fixedAsset}/depreciation/${ids.record}/post`, {}, params)
    expect(again.status).toBe(409)

    const candidates = await call(routes.candidates.GET, 'GET', `/api/fixed-assets/${ids.fixedAsset}/depreciation/${ids.record}/candidates`, undefined, params)
    const list = (await candidates.json()) as { recordAmount: number; candidates: Array<{ id: string; total: number; looksLikeAmortization: boolean }> }
    expect(list.recordAmount).toBe(200.12)
    expect(list.candidates[0]).toMatchObject({ id: entry.id, total: 200.12, looksLikeAmortization: true })
  })

  it('unlinks and links a record, only to an entry of its fiscal year', async () => {
    const params = { id: ids.fixedAsset, entryId: ids.record }
    const path = `/api/fixed-assets/${ids.fixedAsset}/depreciation/${ids.record}`
    const entryId = (await prisma.fixedAssetDepreciation.findUniqueOrThrow({ where: { id: ids.record } })).accountingEntryId

    const unlinked = await call(routes.record.PATCH, 'PATCH', path, { accountingEntryId: null }, params)
    expect(((await unlinked.json()) as { accountingEntryId: string | null }).accountingEntryId).toBeNull()

    const linked = await call(routes.record.PATCH, 'PATCH', path, { accountingEntryId: entryId }, params)
    expect(((await linked.json()) as { accountingEntryId: string | null }).accountingEntryId).toBe(entryId)

    const unknown = await call(routes.record.PATCH, 'PATCH', path, { accountingEntryId: 'nope' }, params)
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).error).toBe('Écriture introuvable')
  })

  it("answers 404 on another company's asset and on a record of another asset", async () => {
    const foreign = await call(routes.asset.GET, 'GET', `/api/fixed-assets/${ids.otherAsset}`, undefined, { id: ids.otherAsset })
    expect(foreign.status).toBe(404)
    const wrongRecord = await call(routes.record.DELETE, 'DELETE', '/x', undefined, { id: ids.fixedAsset, entryId: 'missing' })
    expect(wrongRecord.status).toBe(404)
    expect((await wrongRecord.json()).error).toBe('Amortissement introuvable')
  })

  it('deletes a record, then refuses to delete the asset while its booked entry stands', async () => {
    const monthRecord = await prisma.fixedAssetDepreciation.findFirstOrThrow({ where: { fixedAssetId: ids.fixedAsset, periodType: 'month' } })
    const deleted = await call(routes.record.DELETE, 'DELETE', '/x', undefined, { id: ids.fixedAsset, entryId: monthRecord.id })
    expect(await deleted.json()).toEqual({ success: true })
    expect(await prisma.fixedAssetDepreciation.count({ where: { id: monthRecord.id } })).toBe(0)

    const refused = await call(routes.asset.DELETE, 'DELETE', `/api/fixed-assets/${ids.fixedAsset}`, undefined, { id: ids.fixedAsset })
    expect(refused.status).toBe(409)
  })
})
