/**
 * Annexe, forms 2054 / 2055 / 2033-C and register of accounting methods
 * against PostgreSQL (session mocked, roles from member rows):
 * - GET /api/reports/fixed-asset-movements: the forms read from the
 *   validated entries reconcile with the balance sheet (box BJ) and the
 *   fixed asset register; exports in CSV and PDF (reports:export);
 * - /api/accounting-methods and /api/accounting-changes: the register and the
 *   changes, the catch-up entry prepared as a DRAFT (PCG art. 122-3, 122-6),
 *   replaced while a draft, refused once validated;
 * - GET and PUT /api/annexe, GET /api/annexe/export: the notes of a small
 *   company, what is missing until answered, the Markdown and PDF files;
 *   the approval pack lists the annexe with the same missing items;
 * - a viewer reads but never writes, a member of another company gets 404,
 *   an anonymous request 401.
 *
 * Runs under KLEDG_RLS=enforce too (the whole suite does in CI).
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('annexe')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { FixedAssetReport } from '../fixed-asset-report'
import type { AnnexeView } from '../get-annexe.service'
import type { AccountingChangeView } from '../methods/manage-accounting-methods.service'
import type { ApprovalView } from '@/lib/approval/get-approval.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
const route = {} as Record<string, Record<string, Handler>>

const USERS = {
  owner: { id: 'u-owner', email: 'owner@test.local', name: 'Gérante', role: 'user' },
  accountant: { id: 'u-accountant', email: 'compta@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Associé', role: 'user' },
  outsider: { id: 'u-outsider', email: 'b@test.local', name: 'Autre société', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function call(who: Who, handler: Handler, method: string, path: string, params: Record<string, string> = {}, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'http://localhost' } } : {}),
    }),
    { params: Promise.resolve(params) },
  )
}

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
  }
  const company = await prisma.company.create({
    data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111', legalType: 'SARL', corporateTaxRegime: 'normal', shareCapital: 10000, totalShares: 1000, shareNominalValue: 10 },
  })
  const other = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222', legalType: 'SAS' } })
  await prisma.organization.create({ data: { id: 'org-a', name: 'A', slug: 'org-a', createdAt: new Date(), companyId: company.id } })
  await prisma.organization.create({ data: { id: 'org-b', name: 'B', slug: 'org-b', createdAt: new Date(), companyId: other.id } })
  const members: Array<[string, string, string]> = [
    ['u-owner', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-outsider', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
  const fy = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const otherMethod = await prisma.accountingMethod.create({ data: { companyId: other.id, topic: 'depreciation', label: 'Linéaire', description: 'x' } })

  const an = await prisma.journal.create({ data: { companyId: company.id, code: 'AN', label: 'À-nouveaux' } })
  const od = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
  const accounts: Record<string, string> = {}
  for (const [code, label] of [
    ['101000', 'Capital'],
    ['218200', 'Matériel de transport'],
    ['218300', 'Matériel informatique'],
    ['281820', 'Amortissement du matériel de transport'],
    ['281830', 'Amortissement du matériel informatique'],
    ['404000', 'Fournisseurs d’immobilisations'],
    ['411000', 'Clients'],
    ['512000', 'Banque'],
    ['681100', 'Dotations aux amortissements'],
    ['706000', 'Prestations de services'],
  ]) {
    accounts[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label } })).id
  }
  let n = 0
  const entry = async (journalId: string, date: string, lines: Array<[string, number, number]>) => {
    n++
    const e = await prisma.accountingEntry.create({
      data: { companyId: company.id, fiscalYearId: fy.id, journalId, entryNumber: String(n), date: day(date), description: `Écriture ${n}`, status: 'draft' },
    })
    await prisma.entryLine.createMany({
      data: lines.map(([code, debit, credit]) => ({ accountingEntryId: e.id, accountId: accounts[code], accountFiscalYearId: fy.id, accountingEntryNumber: String(n), debit, credit })),
    })
    await prisma.accountingEntry.update({ where: { id: e.id }, data: { status: 'validated' } })
    return e.id
  }
  // Opening: computers 3 000 € depreciated by 1 000 €, capital 10 000 €, bank 8 000 €
  await entry(an.id, '2026-01-01', [['218300', 3000, 0], ['512000', 8000, 0], ['281830', 0, 1000], ['101000', 0, 10000]])
  await entry(od.id, '2026-03-01', [['218200', 20000, 0], ['404000', 0, 20000]])
  await entry(od.id, '2026-12-31', [['681100', 4600, 0], ['281820', 0, 4000], ['281830', 0, 600]])
  await entry(od.id, '2026-06-30', [['411000', 9000, 0], ['706000', 0, 9000]])

  // The register: the vehicle and the computers, with the depreciation recorded for 2026
  const asset = (label: string, code: string, depCode: string, value: number, acquired: string, start: string, duration: number) =>
    prisma.fixedAsset.create({
      data: {
        companyId: company.id,
        label,
        acquisitionDate: day(acquired),
        acquisitionValue: value,
        depreciationDuration: duration,
        depreciationStartDate: day(start),
        assetAccountId: accounts[code],
        depreciationAccountId: accounts[depCode],
        expenseAccountId: accounts['681100'],
      },
    })
  const car = await asset('Utilitaire', '218200', '281820', 20000, '2026-03-01', '2026-03-01', 5)
  const computers = await asset('Ordinateurs', '218300', '281830', 3000, '2025-01-01', '2025-01-01', 3)
  await prisma.fixedAssetDepreciation.create({ data: { companyId: company.id, fixedAssetId: car.id, fiscalYearId: fy.id, periodType: 'year', year: 2026, amount: 4000 } })
  await prisma.fixedAssetDepreciation.create({ data: { companyId: company.id, fixedAssetId: computers.id, fiscalYearId: fy.id, periodType: 'year', year: 2026, amount: 600 } })

  Object.assign(ids, { company: company.id, other: other.id, fy: fy.id, otherFy: otherFy.id, otherMethod: otherMethod.id })
}

/** Everything a small company must answer, with « Néant » where nothing applies. */
const ANSWERS = {
  derogations: { none: true },
  postClosingEvents: { none: true },
  relatedParties: { none: true },
  commitments: { none: true },
  directorAdvances: { none: true },
  employees: 2,
  taxCredits: { none: true },
  receivableMaturities: { overOneYearCents: 0 },
  debtMaturities: { overOneYearCents: 0, overFiveYearsCents: 0 },
}

describe.skipIf(!available)('annexe, fixed asset forms and accounting methods routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('annexe')
    ;({ prisma } = await import('@/lib/prisma'))
    route.movements = (await import('@/app/api/reports/fixed-asset-movements/route')) as never
    route.movementsExport = (await import('@/app/api/reports/fixed-asset-movements/export/route')) as never
    route.methods = (await import('@/app/api/accounting-methods/route')) as never
    route.method = (await import('@/app/api/accounting-methods/[id]/route')) as never
    route.changes = (await import('@/app/api/accounting-changes/route')) as never
    route.change = (await import('@/app/api/accounting-changes/[id]/route')) as never
    route.changeEntry = (await import('@/app/api/accounting-changes/[id]/entry/route')) as never
    route.annexe = (await import('@/app/api/annexe/route')) as never
    route.annexeExport = (await import('@/app/api/annexe/export/route')) as never
    route.approval = (await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/approval/route')) as never
    route.approvalDocument = (await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/approval/documents/[document]/route')) as never
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const q = (extra: Record<string, string> = {}) => new URLSearchParams({ companyId: ids.company, fiscalYearId: ids.fy, ...extra }).toString()

  describe('fixed asset forms', () => {
    it('reads 2054 and 2055 from the entries, reconciled with the balance sheet and the register', async () => {
      const response = await call('viewer', route.movements.GET, 'GET', `/api/reports/fixed-asset-movements?${q()}`)
      expect(response.status).toBe(200)
      const report = (await response.json()) as FixedAssetReport
      const total = report.form2054.find((r) => r.id === 'grandTotal')!
      expect(total.amounts).toMatchObject({ opening: 300_000, increase: 2_000_000, disposal: 0, closing: 2_300_000 })
      expect(report.form2054.find((r) => r.id === 'transport')?.amounts.increase).toBe(2_000_000)
      expect(report.form2055.find((r) => r.id === 'grandTotal')?.amounts).toEqual({ opening: 100_000, allowance: 460_000, decrease: 0, closing: 560_000 })
      expect(report.form2033c.assets.find((r) => r.id === 'grandTotal')?.amounts.closing).toBe(2_300_000)
      expect(report.checks.find((c) => c.id === 'balance-sheet-gross')).toMatchObject({ booksCents: 2_300_000, otherCents: 2_300_000, ok: true })
      expect(report.checks.find((c) => c.id === 'balance-sheet-depreciation')).toMatchObject({ booksCents: 560_000, ok: true })
      expect(report.checks.filter((c) => !c.ok)).toEqual([])
    })

    it('exports CSV and PDF to members with reports:export only', async () => {
      const csv = await call('accountant', route.movementsExport.GET, 'GET', `/api/reports/fixed-asset-movements/export?${q({ format: 'csv' })}`)
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-type')).toContain('text/csv')
      const text = await csv.text()
      expect(text).toContain('2054-SD;Matériel de transport;Acquisitions, créations, apports, virements;LA;20000,00;218200')
      expect(text).toContain('2033-C-SD cadre II;Total;Amortissements à la fin;576;5600,00;')
      const pdf = await call('owner', route.movementsExport.GET, 'GET', `/api/reports/fixed-asset-movements/export?${q()}`)
      expect(pdf.status).toBe(200)
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
      expect((await call('viewer', route.movementsExport.GET, 'GET', `/api/reports/fixed-asset-movements/export?${q()}`)).status).toBe(403)
    })

    it('never reads another company: 404 for its member, 404 for a fiscal year of another company, 401 anonymous', async () => {
      expect((await call('outsider', route.movements.GET, 'GET', `/api/reports/fixed-asset-movements?${q()}`)).status).toBe(404)
      const foreignYear = new URLSearchParams({ companyId: ids.company, fiscalYearId: ids.otherFy }).toString()
      expect((await call('owner', route.movements.GET, 'GET', `/api/reports/fixed-asset-movements?${foreignYear}`)).status).toBe(404)
      expect((await call('anonymous', route.movements.GET, 'GET', `/api/reports/fixed-asset-movements?${q()}`)).status).toBe(401)
    })
  })

  describe('register of methods and changes', () => {
    it('records, changes and removes a method; a reference method stays one (PCG art. 121-5)', async () => {
      const body = { companyId: ids.company, topic: 'development_costs', label: "Inscription à l'actif", description: 'Frais de développement amortis sur 5 ans', referenceMethod: true }
      expect((await call('viewer', route.methods.POST, 'POST', '/api/accounting-methods', {}, body)).status).toBe(403)
      const created = await call('accountant', route.methods.POST, 'POST', '/api/accounting-methods', {}, body)
      expect(created.status).toBe(201)
      const method = (await created.json()) as { id: string }
      const back = await call('accountant', route.method.PATCH, 'PATCH', `/api/accounting-methods/${method.id}`, { id: method.id }, { ...body, companyId: undefined, referenceMethod: false })
      expect(back.status).toBe(409)
      expect(((await back.json()) as { error: string }).error).toMatch(/irréversible/)
      expect((await call('outsider', route.method.DELETE, 'DELETE', `/api/accounting-methods/${method.id}`, { id: method.id })).status).toBe(404)
      expect((await call('accountant', route.method.DELETE, 'DELETE', `/api/accounting-methods/${method.id}`, { id: method.id })).status).toBe(204)
      await call('accountant', route.methods.POST, 'POST', '/api/accounting-methods', {}, { companyId: ids.company, topic: 'depreciation', label: 'Linéaire', description: "Sur la durée d'utilisation" })
      const list = await call('viewer', route.methods.GET, 'GET', `/api/accounting-methods?${q()}`)
      expect(((await list.json()) as { methods: Array<{ label: string }> }).methods.map((m) => m.label)).toEqual(['Linéaire'])
    })

    it('prepares the catch-up entry of a change of method as a draft at the opening, once (PCG art. 122-3)', async () => {
      const refused = await call('accountant', route.changes.POST, 'POST', '/api/accounting-changes', {}, { companyId: ids.company, fiscalYearId: ids.fy, kind: 'ESTIMATE_CHANGE', treatment: 'EQUITY', label: 'Durée', description: 'Allongée' })
      expect(refused.status).toBe(400)
      expect(((await refused.json()) as { error: string }).error).toMatch(/122-5/)
      const foreign = await call('accountant', route.changes.POST, 'POST', '/api/accounting-changes', {}, { companyId: ids.company, fiscalYearId: ids.fy, kind: 'METHOD_CHANGE', methodId: ids.otherMethod, label: 'x', description: 'y' })
      expect(foreign.status).toBe(404)

      const body = { companyId: ids.company, fiscalYearId: ids.fy, kind: 'METHOD_CHANGE', label: 'Stocks au CMUP', description: 'Meilleure image du coût des ventes', impactCents: 100_000, taxEffectCents: 25_000, accountCode: '310000' }
      const created = await call('accountant', route.changes.POST, 'POST', '/api/accounting-changes', {}, body)
      expect(created.status).toBe(201)
      const change = (await created.json()) as AccountingChangeView
      expect(change).toMatchObject({ treatment: 'EQUITY', netImpactCents: 75_000, entryExpected: true, entry: null })

      const prepare = () => call('accountant', route.changeEntry.POST, 'POST', `/api/accounting-changes/${change.id}/entry`, { id: change.id })
      expect((await prepare()).status).toBe(201)
      expect((await prepare()).status).toBe(201)
      const entries = await prisma.accountingEntry.findMany({ where: { companyId: ids.company, reference: 'CHG-2026' }, include: { lines: { include: { account: { select: { code: true } } } } } })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ status: 'draft', date: day('2026-01-01') })
      expect(entries[0].lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)]).sort()).toEqual([
        ['110', 0, 750],
        ['310000', 1000, 0],
        ['444', 0, 250],
      ])

      // A new impact makes the draft obsolete: it is deleted with the change of figures
      const changed = await call('accountant', route.change.PATCH, 'PATCH', `/api/accounting-changes/${change.id}`, { id: change.id }, { ...body, companyId: undefined, impactCents: 120_000 })
      expect(changed.status).toBe(200)
      expect(((await changed.json()) as AccountingChangeView).entry).toBeNull()
      expect(await prisma.accountingEntry.count({ where: { reference: 'CHG-2026' } })).toBe(0)

      // Validated, the entry is definitive (PCG art. 1031-3): the change keeps its figures
      await prepare()
      const draft = await prisma.accountingEntry.findFirstOrThrow({ where: { reference: 'CHG-2026' } })
      await prisma.accountingEntry.update({ where: { id: draft.id }, data: { status: 'validated', entryNumber: '99' } })
      const locked = await call('accountant', route.change.PATCH, 'PATCH', `/api/accounting-changes/${change.id}`, { id: change.id }, { ...body, companyId: undefined, impactCents: 50_000 })
      expect(locked.status).toBe(409)
      expect((await call('owner', route.change.DELETE, 'DELETE', `/api/accounting-changes/${change.id}`, { id: change.id })).status).toBe(409)
      expect((await call('viewer', route.change.DELETE, 'DELETE', `/api/accounting-changes/${change.id}`, { id: change.id })).status).toBe(403)
    })

    it('a correction of error goes to 678 at the closing and is deleted with its draft', async () => {
      const created = await call('accountant', route.changes.POST, 'POST', '/api/accounting-changes', {}, {
        companyId: ids.company,
        fiscalYearId: ids.fy,
        kind: 'ERROR_CORRECTION',
        label: 'Facture 2025 omise',
        description: 'Une facture de 2025 non comptabilisée',
        impactCents: -30_000,
        accountCode: '408000',
      })
      const change = (await created.json()) as AccountingChangeView
      expect(change.treatment).toBe('RESULT')
      await call('accountant', route.changeEntry.POST, 'POST', `/api/accounting-changes/${change.id}/entry`, { id: change.id })
      const entry = await prisma.accountingEntry.findFirstOrThrow({ where: { accountingChange: { id: change.id } }, include: { lines: { include: { account: { select: { code: true } } } } } })
      expect(entry.date).toEqual(day('2026-12-31'))
      expect(entry.lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)]).sort()).toEqual([
        ['408000', 0, 300],
        ['678', 300, 0],
      ])
      expect((await call('accountant', route.change.DELETE, 'DELETE', `/api/accounting-changes/${change.id}`, { id: change.id })).status).toBe(204)
      expect(await prisma.accountingEntry.count({ where: { id: entry.id } })).toBe(0)
    })
  })

  describe('annexe', () => {
    it('builds the annexe of a small company and asks what the books cannot say', async () => {
      // The size category confirmed on the approval page decides the notes (PCG art. 811-9 for a small company)
      await prisma.accountsApproval.create({ data: { companyId: ids.company, fiscalYearId: ids.fy, details: { size: { category: 'small', employees: null } } } })
      const response = await call('viewer', route.annexe.GET, 'GET', `/api/annexe?${q()}`)
      expect(response.status).toBe(200)
      const view = (await response.json()) as AnnexeView
      expect(view.annexe).toMatchObject({ list: 'small', required: true, categoryConfirmed: true })
      expect(view.annexe.missing.map((m) => m.id).sort()).toEqual(
        ['commitments', 'debtMaturities', 'derogations', 'directorAdvances', 'employees', 'postClosingEvents', 'receivableMaturities', 'relatedParties', 'taxCredits'].sort(),
      )
      expect(view.annexe.notes.map((n) => n.id)).toEqual(expect.arrayContaining(['rules', 'changes', 'fixed-assets', 'depreciation', 'equity']))
      const exported = await call('owner', route.annexeExport.GET, 'GET', `/api/annexe/export?${q({ format: 'md' })}`)
      expect(exported.status).toBe(400)
      expect(((await exported.json()) as { missing: string[] }).missing).toHaveLength(9)
    })

    it('saves the answers (closing:execute) and generates the annexe in Markdown and PDF', async () => {
      const body = { companyId: ids.company, fiscalYearId: ids.fy, details: ANSWERS }
      expect((await call('viewer', route.annexe.PUT, 'PUT', '/api/annexe', {}, body)).status).toBe(403)
      const bad = await call('owner', route.annexe.PUT, 'PUT', '/api/annexe', {}, { ...body, details: { ...ANSWERS, debtMaturities: { overOneYearCents: 10, overFiveYearsCents: 20 } } })
      expect(bad.status).toBe(400)
      const saved = await call('owner', route.annexe.PUT, 'PUT', '/api/annexe', {}, body)
      expect(saved.status).toBe(200)
      expect(((await saved.json()) as AnnexeView).annexe.missing).toEqual([])
      expect(await prisma.annexeNote.count({ where: { companyId: ids.company } })).toBe(1)
      expect(await prisma.auditLog.count({ where: { companyId: ids.company, action: 'SAVE_ANNEXE_NOTES' } })).toBe(1)

      const md = await call('accountant', route.annexeExport.GET, 'GET', `/api/annexe/export?${q({ format: 'md' })}`)
      expect(md.status).toBe(200)
      expect(md.headers.get('content-disposition')).toMatch(/Annexe_Atelier_Lumen_2026\.md/)
      const text = await md.text()
      expect(text).toContain('# Annexe des comptes annuels')
      expect(text).toContain('Règles et méthodes comptables')
      expect(text).toMatch(/Matériel de transport|Immobilisations corporelles/)
      expect(text).toContain('Changement de méthode comptable')
      const pdf = await call('accountant', route.annexeExport.GET, 'GET', `/api/annexe/export?${q()}`)
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    })

    it('is a document of the approval pack, generated there too', async () => {
      const path = `/api/companies/${ids.company}/fiscal-years/${ids.fy}/approval`
      const approval = await call('viewer', route.approval.GET, 'GET', path, { id: ids.company, fiscalYearId: ids.fy })
      const view = (await approval.json()) as ApprovalView
      expect(view.pack.documents.find((d) => d.id === 'annexe')).toMatchObject({ title: 'Annexe des comptes annuels', required: true, missing: [] })
      const doc = await call('owner', route.approvalDocument.GET, 'GET', `${path}/documents/annexe?format=md`, { id: ids.company, fiscalYearId: ids.fy, document: 'annexe' })
      expect(doc.status).toBe(200)
      expect(await doc.text()).toContain('# Annexe des comptes annuels')
    })

    it('stays in its company', async () => {
      expect((await call('outsider', route.annexe.GET, 'GET', `/api/annexe?${q()}`)).status).toBe(404)
      expect((await call('outsider', route.annexe.PUT, 'PUT', '/api/annexe', {}, { companyId: ids.company, fiscalYearId: ids.fy, details: ANSWERS })).status).toBe(404)
      expect((await call('owner', route.annexe.PUT, 'PUT', '/api/annexe', {}, { companyId: ids.company, fiscalYearId: ids.otherFy, details: ANSWERS })).status).toBe(404)
      expect((await call('anonymous', route.annexe.GET, 'GET', `/api/annexe?${q()}`)).status).toBe(401)
    })
  })
})
