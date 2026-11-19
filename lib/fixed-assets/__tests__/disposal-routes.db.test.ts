/**
 * Exit of a fixed asset against PostgreSQL (session and roles mocked):
 * POST /api/fixed-assets/[id]/disposal computes the gain and prepares the
 * exit entry as a draft (28 and 657 debit, 2x credit, 462 and 757 for the
 * price; PCG chart amended by règlement ANC n° 2022-06), DELETE cancels it;
 * a validated exit is definitive (PCG art. 1031-3). The fixed asset report
 * then fills 2033-C-SD cadre III. Skipped without the test database server.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ids = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('fixed_asset_disposal')
  return {} as Record<string, string>
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === ids.company ? ['companyAdmin'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import type { DisposalPreview } from '@/lib/fixed-assets/disposal'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Routes = Record<string, Handler>
let prisma: typeof import('@/lib/prisma').prisma
let disposalRoute: Routes
let assetRoute: Routes

function call(handler: Handler, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, params ? { params: Promise.resolve(params) } : undefined)
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789', legalType: 'SAS' } })
  await seedMembership(prisma, 'user-1', company.id)
  const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const fy2026 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const accounts: Record<string, string> = {}
  for (const fy of [fy2025, fy2026]) {
    for (const [code, label] of [['218200', 'Matériel de transport'], ['281820', 'Amortissements du matériel de transport'], ['681120', 'Dotations aux amortissements'], ['261000', 'Titres de participation']]) {
      const a = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })
      if (fy === fy2025) accounts[code] = a.id
    }
  }
  // A van bought 2025-01-01 for 12 000 €, 5 years linear: 2 400 € a year
  const van = await prisma.fixedAsset.create({
    data: {
      companyId: company.id,
      label: 'Utilitaire',
      acquisitionDate: day('2025-01-01'),
      acquisitionValue: 12000,
      depreciationStartDate: day('2025-01-01'),
      depreciationDuration: 5,
      assetAccountId: accounts['218200'],
      depreciationAccountId: accounts['281820'],
      expenseAccountId: accounts['681120'],
    },
  })
  await prisma.fixedAssetDepreciation.create({
    data: { companyId: company.id, fixedAssetId: van.id, fiscalYearId: fy2025.id, periodType: 'year', year: 2025, amount: 2400 },
  })
  const shares = await prisma.fixedAsset.create({
    data: {
      companyId: company.id,
      label: 'Titres',
      acquisitionDate: day('2025-01-01'),
      acquisitionValue: 5000,
      depreciationMethod: 'none',
      depreciationStartDate: day('2025-01-01'),
      assetAccountId: accounts['261000'],
      depreciationAccountId: accounts['261000'],
      expenseAccountId: accounts['681120'],
    },
  })
  Object.assign(ids, { company: company.id, fy2025: fy2025.id, fy2026: fy2026.id, van: van.id, shares: shares.id })
}

describe.skipIf(!available)('fixed asset disposal routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('fixed_asset_disposal')
    ;({ prisma } = await import('@/lib/prisma'))
    disposalRoute = (await import('@/app/api/fixed-assets/[id]/disposal/route')) as unknown as Routes
    assetRoute = (await import('@/app/api/fixed-assets/[id]/route')) as unknown as Routes
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const post = (id: string, body: unknown) => call(disposalRoute.POST, 'POST', `/api/fixed-assets/${id}/disposal`, body, { id })

  it('previews the sale: depreciation to the day of exit, gain short term under IS, nothing written', async () => {
    const res = await post(ids.van, { disposalDate: '2026-06-30', kind: 'sale', price: '9000', dryRun: true })
    expect(res.status).toBe(200)
    const preview = (await res.json()) as DisposalPreview
    // 2 400 € recorded for 2025, then the plan to 2026-06-30 (181 days of 2026)
    const year2026 = preview.depreciationCents - 240_000
    expect(year2026).toBe(Math.round((240_000 * 181) / 365))
    expect(preview).toMatchObject({ grossCents: 1_200_000, priceCents: 900_000, entry: null })
    const nbv = 1_200_000 - preview.depreciationCents
    expect(preview.result).toMatchObject({ netBookValueCents: nbv, gainCents: 900_000 - nbv, shortTermCents: 900_000 - nbv, longTermCents: 0 })
    expect(preview.lines.map((l) => [l.code, l.debitCents, l.creditCents])).toEqual([
      ['281820', preview.depreciationCents, 0],
      ['657', nbv, 0],
      ['218200', 0, 1_200_000],
      ['462', 900_000, 0],
      ['757', 0, 900_000],
    ])
    expect(preview.warnings.some((w) => w.includes("n'est pas encore comptabilisée"))).toBe(true)
    expect(preview.warnings.some((w) => w.includes('TVA'))).toBe(true)
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: ids.van } })
    expect(asset.disposalKind).toBeNull()
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.company } })).toBe(0)
  })

  it('records the exit with its draft entry in the OD journal, and replaces the draft when recorded again', async () => {
    const first = (await (await post(ids.van, { disposalDate: '2026-06-30', kind: 'sale', price: 9000 })).json()) as DisposalPreview
    expect(first.entry?.id).toBeTruthy()
    const second = (await (await post(ids.van, { disposalDate: '2026-06-30', kind: 'sale', price: 9000, priceRecorded: true })).json()) as DisposalPreview
    expect(second.lines.map((l) => l.code)).toEqual(['281820', '657', '218200'])
    expect(await prisma.accountingEntry.count({ where: { id: first.entry!.id } })).toBe(0)

    const entry = await prisma.accountingEntry.findUniqueOrThrow({
      where: { id: second.entry!.id },
      include: { journal: true, lines: { include: { account: true } } },
    })
    expect(entry).toMatchObject({ status: 'draft', fiscalYearId: ids.fy2026, journal: { code: 'OD' } })
    expect(entry.date.toISOString().slice(0, 10)).toBe('2026-06-30')
    expect(entry.lines.map((l) => l.account.code).sort()).toEqual(['218200', '281820', '657'])
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: ids.van } })
    expect(asset).toMatchObject({ disposalKind: 'sale', disposalEntryId: entry.id })
    expect(asset.disposalPrice?.toString()).toBe('9000')
    expect(asset.disposalDate?.toISOString().slice(0, 10)).toBe('2026-06-30')

    // The date belongs to the exit now: the asset form cannot move it
    const patch = await call(assetRoute.PATCH, 'PATCH', `/api/fixed-assets/${ids.van}`, { disposalDate: '2026-07-31' }, { id: ids.van })
    expect(patch.status).toBe(400)
  })

  it('fills 2033-C-SD cadre III of the year of exit', async () => {
    const { getFixedAssetMovements } = await import('@/lib/annexe/get-fixed-asset-movements.service')
    const report = await getFixedAssetMovements(ids.company, ids.fy2026)
    const [row] = report.disposals.rows
    expect(report.disposals.rows).toHaveLength(1)
    expect(row).toMatchObject({ label: 'Utilitaire', grossCents: 1_200_000, priceCents: 900_000 })
    expect(row.residualCents).toBe(row.grossCents - row.depreciationCents)
    expect(row.shortTermCents).toBe(row.gainCents)
    expect(row.gainCents).toBe(900_000 - row.residualCents)
    expect(report.disposals.form2033c.find((t) => t.box === '584')?.cents).toBe(900_000)
  })

  it('cancels a draft exit: the entry is deleted, the asset is back in the assets', async () => {
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: ids.van } })
    const res = await call(disposalRoute.DELETE, 'DELETE', `/api/fixed-assets/${ids.van}/disposal`, undefined, { id: ids.van })
    expect(await res.json()).toEqual({ deletedEntry: true })
    const back = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: ids.van } })
    expect(back).toMatchObject({ disposalKind: null, disposalDate: null, disposalPrice: null, disposalEntryId: null })
    expect(await prisma.accountingEntry.count({ where: { id: asset.disposalEntryId! } })).toBe(0)
    expect((await call(disposalRoute.DELETE, 'DELETE', `/api/fixed-assets/${ids.van}/disposal`, undefined, { id: ids.van })).status).toBe(400)
  })

  it('refuses securities, a day outside the fiscal years and a date before the acquisition', async () => {
    const shares = await post(ids.shares, { disposalDate: '2026-06-30', kind: 'sale', price: 6000 })
    expect(shares.status).toBe(400)
    expect(((await shares.json()) as { error: string }).error).toContain('26, 27')
    expect((await post(ids.van, { disposalDate: '2027-06-30', kind: 'sale' })).status).toBe(400)
    expect((await post(ids.van, { disposalDate: '2024-06-30', kind: 'sale' })).status).toBe(400)
    expect((await post(ids.van, { disposalDate: '2026-06-30', kind: 'donation' })).status).toBe(400)
  })
  it('refuses to change, cancel or delete a validated exit (PCG art. 1031-3)', async () => {
    const recorded = (await (await post(ids.van, { disposalDate: '2026-06-30', kind: 'scrap' })).json()) as DisposalPreview
    const { validateEntryInTx } = await import('@/lib/accounting/services/entry-lifecycle.service')
    await prisma.$transaction((tx) => validateEntryInTx(tx, recorded.entry!.id, ids.company))
    expect((await post(ids.van, { disposalDate: '2026-06-30', kind: 'sale', price: 100 })).status).toBe(409)
    expect((await call(disposalRoute.DELETE, 'DELETE', `/api/fixed-assets/${ids.van}/disposal`, undefined, { id: ids.van })).status).toBe(409)
    expect((await call(assetRoute.DELETE, 'DELETE', `/api/fixed-assets/${ids.van}`, undefined, { id: ids.van })).status).toBe(409)
  })
})
