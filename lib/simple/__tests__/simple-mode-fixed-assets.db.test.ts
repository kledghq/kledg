/**
 * Durable equipment in simple mode against PostgreSQL
 * (docs/categories-simples.md), through the real routes with only the
 * session mocked, on the PCG chart Kledg seeds:
 * - confirming a purchase the user will use more than a year books it to
 *   the fixed asset account and creates the fixed asset in the same
 *   transaction: amount excluding the recovered VAT, transaction date as
 *   acquisition and depreciation start (PCG art. 214-13), linear over the
 *   usual life of the category (BOI-BIC-AMT-10-40-30), linked to the entry
 *   and recorded on the simple mode row;
 * - a consumable answer or a purchase under 500 € HT creates none;
 * - undoing the reconciliation, or deleting the draft, deletes the asset;
 * - the undo is refused while a depreciation of the asset is booked;
 * - an accountant who books the draft elsewhere than the asset account
 *   deletes the asset (refused while a depreciation is booked), and one who
 *   changes the amount on the asset account changes its acquisition value
 *   and depreciation plan (refused likewise);
 * - with accountant review, the asset is linked to the draft and the
 *   accountant's list shows "Immobilisation créée : ..., amortie sur N ans".
 * Run with KLEDG_RLS=enforce too (docs/rls.md).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('simple_fa')
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { buildDepreciationPlan, sumPlanCentsForPeriod } from '@/lib/fixed-assets/depreciation-plan'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let records: typeof import('@/lib/fixed-assets/manage-depreciation-records.service')
let assets: typeof import('@/lib/fixed-assets/delete-fixed-asset.service')
const routes = {} as Record<string, Module>

const USERS = {
  owner: { id: 'u-owner', email: 'claire@test.local', name: 'Claire Petit', role: 'user' },
  accountant: { id: 'u-acc', email: 'marc@test.local', name: 'Marc Renaud', role: 'user' },
}
type Who = keyof typeof USERS

async function call(as: Who, route: string, method: string, path: string, options: { body?: unknown; params?: Record<string, string> } = {}) {
  state.user = USERS[as]
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve(options.params ?? {}) })
}

interface Company {
  id: string
  fiscalYearId: string
  bankAccountId: string
}

let seq = 0

async function seedCompany(slug: string, siren: string): Promise<Company> {
  const { seedPCG } = await import('@/prisma/seeds/pcg')
  const company = await prisma.company.create({ data: { name: slug, slug, siren } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  await seedPCG(company.id, fy.id, false)
  await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${slug}`, name: 'Compte courant' } })
  return { id: company.id, fiscalYearId: fy.id, bankAccountId: bankAccount.id }
}

async function transaction(company: Company, label: string, amount: number, day = '2026-03-10') {
  seq += 1
  return prisma.bankTransaction.create({
    data: { bankAccountId: company.bankAccountId, externalTransactionId: `fa-${seq}`, amount, date: new Date(`${day}T00:00:00Z`), side: 'debit', label },
  })
}

const cents = (value: { toString(): string } | null) => (value === null ? null : Math.round(Number(value.toString()) * 100))

describe.skipIf(!available)('simple mode fixed assets (PostgreSQL)', () => {
  let a: Company

  beforeAll(async () => {
    await prepareTestDatabase('simple_fa')
    ;({ prisma } = await import('@/lib/prisma'))
    records = await import('@/lib/fixed-assets/manage-depreciation-records.service')
    assets = await import('@/lib/fixed-assets/delete-fixed-asset.service')
    Object.assign(routes, {
      confirm: await import('@/app/api/simple/expenses/[id]/confirm/route'),
      entries: await import('@/app/api/simple/entries/route'),
      bulkValidate: await import('@/app/api/entries/bulk-validate/route'),
      reconcile: await import('@/app/api/transactions/[id]/reconcile/route'),
      entry: await import('@/app/api/entries/[id]/route'),
    })
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('simple_fa')
    a = await seedCompany('atelier-lumen', '940000601')
    await seedMembership(prisma, USERS.owner.id, a.id, 'companyAdmin')
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  async function addAccountant() {
    await seedMembership(prisma, USERS.accountant.id, a.id, 'accountant')
  }

  const confirm = (id: string, body: unknown) => call('owner', 'confirm', 'POST', `/api/simple/expenses/${id}/confirm`, { body, params: { id } })
  const undo = (as: Who, id: string) => call(as, 'reconcile', 'DELETE', `/api/transactions/${id}/reconcile`, { params: { id } })

  async function buyComputer() {
    const mac = await transaction(a, 'CB APPLE STORE OPERA', 1499)
    const response = await confirm(mac.id, { categoryId: 'materiel-informatique', answers: { durable: 'durable' } })
    expect(response.status).toBe(201)
    return { mac, result: await response.json() }
  }

  it('creates the fixed asset with the entry: amount excluding VAT, transaction date, 3 years linear, linked', async () => {
    const { mac, result } = await buyComputer()
    expect(result).toMatchObject({ status: 'validated', fixedAsset: { label: 'Matériel informatique (Apple Store Opera)', years: 3, amountCents: 124_917 } })

    const asset = await prisma.fixedAsset.findUniqueOrThrow({
      where: { id: result.fixedAsset.id },
      include: { assetAccount: true, depreciationAccount: true, expenseAccount: true, simpleModeEntry: true },
    })
    expect(asset).toMatchObject({
      companyId: a.id,
      label: 'Matériel informatique (Apple Store Opera)',
      acquisitionDate: new Date('2026-03-10T00:00:00Z'),
      depreciationStartDate: new Date('2026-03-10T00:00:00Z'),
      depreciationMethod: 'linear',
      depreciationDuration: 3,
      depreciationRate: null,
      amortizableAmount: null,
      isFullyPaid: true,
      isActive: true,
      acquisitionEntryId: result.entryId,
    })
    expect(asset.comment).toBe('Créée par le mode simple à la confirmation du paiement du 10/03/2026 (CB APPLE STORE OPERA).')
    // The debited asset line, VAT on 44562 recovered (PCG art. 213-1: cost excluding recoverable taxes)
    expect(cents(asset.acquisitionValue)).toBe(124_917)
    expect([asset.assetAccount.code, asset.depreciationAccount.code, asset.expenseAccount.code]).toEqual(['2183', '2818', '6811'])
    expect(asset.assetAccount.fiscalYearId).toBe(a.fiscalYearId)
    expect(asset.simpleModeEntry).toMatchObject({ entryId: result.entryId, bankTransactionId: mac.id, fixedAssetId: asset.id })
    const line = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: result.entryId, accountId: asset.assetAccountId } })
    expect(cents(line.debit)).toBe(124_917)

    // Depreciation plan: 3 years from 10 March 2026, prorata temporis (CGI art. 39, 1-2°)
    const plan = buildDepreciationPlan(asset)
    expect(plan.duration).toBe(3)
    expect([...plan.byMonth.keys()][0]).toBe('2026-03')
    expect([...plan.byMonth.keys()].at(-1)).toBe('2029-03')
    const total = sumPlanCentsForPeriod(plan, new Date('2026-01-01T00:00:00Z'), new Date('2030-12-31T00:00:00Z'))
    expect(total).toBe(124_917)
    // 2026: 297 days of 365 of an annual allowance of 1 249,17 / 3
    const first = sumPlanCentsForPeriod(plan, new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'))
    expect(Math.abs(first - Math.round((124_917 / 3) * (297 / 365)))).toBeLessThanOrEqual(1)

    // Audit trail names the asset
    const audit = await prisma.auditLog.findFirst({ where: { companyId: a.id, action: 'SIMPLE_MODE_CONFIRM' } })
    expect(audit?.metadata).toMatchObject({ fixedAssetId: asset.id })
  })

  it('uses the category duration: furniture 10 years on 2818, tools 5 years on 2815', async () => {
    const desk = await transaction(a, 'CB BUREAU VALLEE', 900)
    const furniture = await (await confirm(desk.id, { categoryId: 'mobilier', answers: { durable: 'durable' } })).json()
    const lathe = await transaction(a, 'CB MANOMANO', 2400)
    const tools = await (await confirm(lathe.id, { categoryId: 'outillage', answers: { durable: 'durable' } })).json()
    const rows = await prisma.fixedAsset.findMany({
      where: { id: { in: [furniture.fixedAsset.id, tools.fixedAsset.id] } },
      select: { depreciationDuration: true, acquisitionValue: true, assetAccount: { select: { code: true } }, depreciationAccount: { select: { code: true } } },
      orderBy: { depreciationDuration: 'desc' },
    })
    expect(rows.map((r) => [r.assetAccount.code, r.depreciationAccount.code, r.depreciationDuration, cents(r.acquisitionValue)])).toEqual([
      ['2184', '2818', 10, 75_000],
      ['2155', '2815', 5, 200_000],
    ])
  })

  it('creates no asset for a consumable or a purchase under 500 € HT', async () => {
    const mouse = await transaction(a, 'CB APPLE STORE OPERA', 1499)
    expect((await (await confirm(mouse.id, { categoryId: 'materiel-informatique', answers: { durable: 'consumable' } })).json()).fixedAsset).toBeNull()
    const cable = await transaction(a, 'CB FNAC', 120)
    expect((await (await confirm(cable.id, { categoryId: 'materiel-informatique', answers: { durable: 'durable' } })).json()).fixedAsset).toBeNull()
    expect(await prisma.fixedAsset.count({ where: { companyId: a.id } })).toBe(0)
  })

  it('with accountant review, links the asset to the draft and shows it in the review list', async () => {
    await addAccountant()
    const { result } = await buyComputer()
    expect(result).toMatchObject({ status: 'draft', needsReview: true, fixedAsset: { years: 3 } })
    expect((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: result.fixedAsset.id } })).acquisitionEntryId).toBe(result.entryId)

    const list = await call('accountant', 'entries', 'GET', `/api/simple/entries?companyId=${a.id}&from=2026-03-01&to=2026-03-31`)
    expect(list.status).toBe(200)
    const view = await list.json()
    expect(view.items).toEqual([
      expect.objectContaining({
        entryId: result.entryId,
        status: 'draft',
        answerLabels: ["Allez-vous l'utiliser plus d'un an\u00a0? Oui, un ordinateur ou un écran"],
        fixedAsset: {
          id: result.fixedAsset.id,
          label: 'Matériel informatique (Apple Store Opera)',
          years: 3,
          mention: 'Immobilisation créée : Matériel informatique (Apple Store Opera), amortie sur 3 ans',
        },
      }),
    ])

    // The accountant validates the entry: the asset stays, linked
    const validated = await call('accountant', 'bulkValidate', 'POST', '/api/entries/bulk-validate', { body: { companyId: a.id, entryIds: [result.entryId], status: 'validated' } })
    expect(validated.status).toBe(200)
    expect(await prisma.fixedAsset.count({ where: { acquisitionEntryId: result.entryId } })).toBe(1)
  })

  it('undoing the reconciliation deletes the asset with the draft', async () => {
    await addAccountant()
    const { mac, result } = await buyComputer()
    const response = await undo('accountant', mac.id)
    expect(response.status).toBe(200)
    expect(await prisma.accountingEntry.count({ where: { id: result.entryId } })).toBe(0)
    expect(await prisma.fixedAsset.count({ where: { companyId: a.id } })).toBe(0)
    expect(await prisma.simpleModeEntry.count()).toBe(0)
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: mac.id } })).reconciled).toBe(false)

    // Confirmed again, then the draft deleted from the entries list: the asset goes too
    const again = await (await confirm(mac.id, { categoryId: 'materiel-informatique', answers: { durable: 'durable' } })).json()
    const deleted = await call('accountant', 'entry', 'DELETE', `/api/entries/${again.entryId}`, { params: { id: again.entryId } })
    expect(deleted.status).toBeLessThan(300)
    expect(await prisma.fixedAsset.count({ where: { companyId: a.id } })).toBe(0)
  })

  it('refuses the undo and the deletion of the draft while a depreciation of the asset is booked', async () => {
    await addAccountant()
    const { mac, result } = await buyComputer()
    const record = await records.saveDepreciationRecord(a.id, result.fixedAsset.id, { fiscalYearId: a.fiscalYearId, periodType: 'month', monthIndex: 2 })
    const posted = await records.postDepreciationRecord(a.id, result.fixedAsset.id, record.id)

    const refused = await undo('accountant', mac.id)
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe(
      `Le rapprochement ne peut pas être annulé : l'écriture n° ${result.entryNumber} a créé l'immobilisation « Matériel informatique (Apple Store Opera) », qui ne peut pas être supprimée. ` +
        `Cette immobilisation a 1 dotation aux amortissements comptabilisée (écriture n° ${posted.accountingEntry.entryNumber}). Une écriture validée ne peut pas être supprimée : contre-passez-la depuis la fiche de l'écriture avant de supprimer l'immobilisation, ou enregistrez plutôt sa sortie (cession ou mise au rebut).`,
    )
    // Nothing changed
    expect(await prisma.fixedAsset.count({ where: { id: result.fixedAsset.id } })).toBe(1)
    expect(await prisma.accountingEntry.count({ where: { id: result.entryId } })).toBe(1)
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: mac.id } })).reconciled).toBe(true)

    // Deleting the draft directly is refused the same way
    const deleted = await call('accountant', 'entry', 'DELETE', `/api/entries/${result.entryId}`, { params: { id: result.entryId } })
    expect(deleted.status).toBe(409)
    expect((await deleted.json()).error).toMatch(/^Cette écriture a créé l'immobilisation « Matériel informatique \(Apple Store Opera\) », qui ne peut pas être supprimée avec elle\. Cette immobilisation a 1 dotation/)
  })

  it('a draft depreciation goes with the asset, and an asset deleted by hand frees the simple mode row', async () => {
    await addAccountant()
    const first = await buyComputer()
    const record = await records.saveDepreciationRecord(a.id, first.result.fixedAsset.id, { fiscalYearId: a.fiscalYearId, periodType: 'year' })
    expect(cents(record.amount)).toBeGreaterThan(0)
    expect((await undo('accountant', first.mac.id)).status).toBe(200)
    expect(await prisma.fixedAssetDepreciation.count()).toBe(0)

    const second = await buyComputer()
    await assets.deleteFixedAsset(a.id, second.result.fixedAsset.id)
    const row = await prisma.simpleModeEntry.findUniqueOrThrow({ where: { entryId: second.result.entryId } })
    expect(row.fixedAssetId).toBeNull()
    // The entry stays, as booked
    expect(await prisma.accountingEntry.count({ where: { id: second.result.entryId } })).toBe(1)
  })

  /** The draft's lines as the entry form sends them back, changed by `edit`. */
  async function editDraft(entryId: string, edit: (lines: Array<{ code: string; accountId: string; debit: string; credit: string }>) => Array<{ code: string; debit: string; credit: string }>) {
    const current = await prisma.entryLine.findMany({ where: { accountingEntryId: entryId }, include: { account: { select: { code: true } } }, orderBy: { id: 'asc' } })
    const lines = edit(current.map((l) => ({ code: l.account.code, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) })))
    const accounts = await prisma.account.findMany({ where: { companyId: a.id, fiscalYearId: a.fiscalYearId, code: { in: lines.map((l) => l.code) } } })
    const body = { lines: lines.map((l) => ({ accountId: accounts.find((acc) => acc.code === l.code)!.id, debit: l.debit, credit: l.credit })) }
    return call('accountant', 'entry', 'PATCH', `/api/entries/${entryId}`, { body, params: { id: entryId } })
  }

  const linesOf = async (entryId: string) =>
    (await prisma.entryLine.findMany({ where: { accountingEntryId: entryId }, include: { account: { select: { code: true } } } }))
      .map((l) => [l.account.code, cents(l.debit), cents(l.credit)])
      .sort()

  it('deletes the asset and frees the simple mode row when the accountant books the draft as an expense', async () => {
    await addAccountant()
    const { result } = await buyComputer()
    // A draft depreciation of the asset goes with it
    await records.saveDepreciationRecord(a.id, result.fixedAsset.id, { fiscalYearId: a.fiscalYearId, periodType: 'year' })

    // 2183 Matériel informatique becomes 6063 Fournitures d'entretien et de petit équipement
    const response = await editDraft(result.entryId, (lines) => lines.map((l) => (l.code === '2183' ? { ...l, code: '6063' } : l)))
    expect(response.status).toBe(200)
    expect(await linesOf(result.entryId)).toEqual([['44562', 24_983, 0], ['5121', 0, 149_900], ['6063', 124_917, 0]].sort())
    expect(await prisma.fixedAsset.count({ where: { companyId: a.id } })).toBe(0)
    expect(await prisma.fixedAssetDepreciation.count()).toBe(0)
    expect((await prisma.simpleModeEntry.findUniqueOrThrow({ where: { entryId: result.entryId } })).fixedAssetId).toBeNull()
  })

  it('refuses to book the draft elsewhere than the asset account while a depreciation is booked', async () => {
    await addAccountant()
    const { result } = await buyComputer()
    const record = await records.saveDepreciationRecord(a.id, result.fixedAsset.id, { fiscalYearId: a.fiscalYearId, periodType: 'month', monthIndex: 2 })
    const posted = await records.postDepreciationRecord(a.id, result.fixedAsset.id, record.id)
    const before = await linesOf(result.entryId)

    const response = await editDraft(result.entryId, (lines) => lines.map((l) => (l.code === '2183' ? { ...l, code: '6063' } : l)))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(
      `L'écriture n° ${result.entryNumber} ne peut pas être modifiée ainsi : elle a créé l'immobilisation « Matériel informatique (Apple Store Opera) » au compte 2183, qui ne peut pas être supprimée. ` +
        `Cette immobilisation a 1 dotation aux amortissements comptabilisée (écriture n° ${posted.accountingEntry.entryNumber}). Une écriture validée ne peut pas être supprimée : contre-passez-la depuis la fiche de l'écriture avant de supprimer l'immobilisation, ou enregistrez plutôt sa sortie (cession ou mise au rebut).`,
    )
    // Nothing changed
    expect(await linesOf(result.entryId)).toEqual(before)
    expect(await prisma.fixedAsset.count({ where: { id: result.fixedAsset.id } })).toBe(1)
    expect((await prisma.simpleModeEntry.findUniqueOrThrow({ where: { entryId: result.entryId } })).fixedAssetId).toBe(result.fixedAsset.id)
  })

  it('changes the acquisition value and the depreciation plan when the amount on the asset account changes', async () => {
    await addAccountant()
    const { result } = await buyComputer()
    // An unbooked depreciation was computed on the old value: it goes, to be computed again
    await records.saveDepreciationRecord(a.id, result.fixedAsset.id, { fiscalYearId: a.fiscalYearId, periodType: 'year' })

    // 249,17 of the purchase were supplies: 1 000,00 stays on 2183
    const response = await editDraft(result.entryId, (lines) => [
      ...lines.map((l) => (l.code === '2183' ? { ...l, debit: '1000.00' } : l)),
      { code: '6063', debit: '249.17', credit: '0.00' },
    ])
    expect(response.status).toBe(200)
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: result.fixedAsset.id } })
    expect(cents(asset.acquisitionValue)).toBe(100_000)
    expect(asset.acquisitionEntryId).toBe(result.entryId)
    expect(await prisma.fixedAssetDepreciation.count()).toBe(0)
    // The plan follows: 1 000,00 over 3 years from 10 March 2026
    const plan = buildDepreciationPlan(asset)
    expect(sumPlanCentsForPeriod(plan, new Date('2026-01-01T00:00:00Z'), new Date('2030-12-31T00:00:00Z'))).toBe(100_000)
    const first = sumPlanCentsForPeriod(plan, new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'))
    expect(Math.abs(first - Math.round((100_000 / 3) * (297 / 365)))).toBeLessThanOrEqual(1)
    expect((await prisma.simpleModeEntry.findUniqueOrThrow({ where: { entryId: result.entryId } })).fixedAssetId).toBe(asset.id)

    // An edit that keeps the asset line leaves the asset as it is
    const described = await call('accountant', 'entry', 'PATCH', `/api/entries/${result.entryId}`, { body: { description: 'Apple Store, MacBook et câbles' }, params: { id: result.entryId } })
    expect(described.status).toBe(200)
    const same = await editDraft(result.entryId, (lines) => lines)
    expect(same.status).toBe(200)
    const after = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: result.fixedAsset.id } })
    expect([cents(after.acquisitionValue), after.updatedAt]).toEqual([100_000, asset.updatedAt])
  })

  it('refuses to change the amount on the asset account while a depreciation is booked', async () => {
    await addAccountant()
    const { result } = await buyComputer()
    const record = await records.saveDepreciationRecord(a.id, result.fixedAsset.id, { fiscalYearId: a.fiscalYearId, periodType: 'month', monthIndex: 2 })
    const posted = await records.postDepreciationRecord(a.id, result.fixedAsset.id, record.id)

    const response = await editDraft(result.entryId, (lines) => [
      ...lines.map((l) => (l.code === '2183' ? { ...l, debit: '1000.00' } : l)),
      { code: '6063', debit: '249.17', credit: '0.00' },
    ])
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(
      `L'écriture n° ${result.entryNumber} ne peut pas être modifiée ainsi : elle a créé l'immobilisation « Matériel informatique (Apple Store Opera) », amortie sur 1 249,17 €, et ne peut pas la porter à 1 000,00 €. ` +
        `Cette immobilisation a 1 dotation aux amortissements comptabilisée (écriture n° ${posted.accountingEntry.entryNumber}) calculée sur l'ancienne valeur : contre-passez-la depuis la fiche de l'écriture avant de changer le montant.`,
    )
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: result.fixedAsset.id } })
    expect(cents(asset.acquisitionValue)).toBe(124_917)
    expect(await prisma.fixedAssetDepreciation.count()).toBe(1)
  })

  it('the database refuses to delete an entry that still carries its asset', async () => {
    await addAccountant()
    const { result } = await buyComputer()
    await expect(prisma.accountingEntry.delete({ where: { id: result.entryId } })).rejects.toThrow()
    expect(await prisma.fixedAsset.count({ where: { id: result.fixedAsset.id } })).toBe(1)
  })
})
