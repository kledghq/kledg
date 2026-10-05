/**
 * Declarations tracker against PostgreSQL (session mocked, roles from
 * member rows; skipped without the server; also run with
 * KLEDG_RLS=enforce). A SAS at the réel normal of VAT and the régime
 * simplifié of IS, calendar years, on 5 October 2026 (clock faked):
 * - the facts of other modules feed the statuses, never entered twice: the
 *   CA3 of August recorded as filed (paid with the return, CGI art. 1692),
 *   the 2065 of 2025 filed, the first IS acompte of 2026 paid, the accounts
 *   of 2025 approved; their fields are refused in the tracker (409 with the
 *   page where they are recorded);
 * - the CFE acompte of 15 June 2026 comes from the avis of 2025 (3 500 €,
 *   CGI art. 1679 quinquies) and is late until marked paid;
 * - marks by role (owner, accountant; viewer 403; non-member 404; anonymous
 *   401), partial updates, a receipt of the company only, dates never in
 *   the future, a return never "paid", removal, the simple home "À faire";
 * - the database constraints.
 * Fictitious data.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('declarations')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { writeAuditLog } from '@/lib/audit'
import type { DeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import type { TrackedDeadline } from '../status'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let simpleHome: typeof import('@/lib/simple/load-simple-home.service')
let statuses: typeof import('../load-declaration-statuses.service')
let deadlinesSvc: typeof import('@/lib/deadlines/load-deadlines.service')
let routes: { deadlines: Record<'GET', Handler>; status: Record<'PUT' | 'DELETE', Handler> }

const USERS = {
  owner: { id: 'u-dec-owner', email: 'owner@dec.test', name: 'Gérante', role: 'user' },
  accountant: { id: 'u-dec-accountant', email: 'compta@dec.test', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-dec-viewer', email: 'viewer@dec.test', name: 'Associé', role: 'user' },
  outsider: { id: 'u-dec-outsider', email: 'other@dec.test', name: 'Autre', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

const NOW = new Date('2026-10-05T09:00:00Z')
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ids = {} as Record<string, string>

function call(who: Who, handler: Handler, method: string, path: string, body?: unknown) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    }),
    { params: Promise.resolve({ id: ids.company }) },
  )
}

const statusPath = () => `/api/companies/${ids.company}/declarations/status`
const mark = (who: Who, body: Record<string, unknown>) => call(who, routes.status.PUT, 'PUT', statusPath(), body)

async function calendar(): Promise<Map<string, TrackedDeadline>> {
  const response = await call('viewer', routes.deadlines.GET, 'GET', `/api/deadlines?companyId=${ids.company}&fiscalYearId=${ids.fy2026}`)
  expect(response.status).toBe(200)
  const view = (await response.json()) as DeadlinesView
  return new Map(view.deadlines.map((d) => [d.id, d]))
}

describe.skipIf(!available)('declarations tracker (PostgreSQL)', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    await prepareTestDatabase('declarations')
    ;({ prisma } = await import('@/lib/prisma'))
    simpleHome = await import('@/lib/simple/load-simple-home.service')
    statuses = await import('../load-declaration-statuses.service')
    deadlinesSvc = await import('@/lib/deadlines/load-deadlines.service')
    routes = {
      deadlines: (await import('@/app/api/deadlines/route')) as unknown as typeof routes.deadlines,
      status: (await import('@/app/api/companies/[id]/declarations/status/route')) as unknown as typeof routes.status,
    }

    const company = await prisma.company.create({
      data: {
        name: 'Atelier Delta',
        slug: 'atelier-delta',
        siren: '970000101',
        legalType: 'SAS',
        vatRegime: 'normal',
        corporateTaxRegime: 'simplified',
        foundationDate: day('2020-01-06'),
        deadlineSettings: { vatFilingDay: 19, cvae: true, cvaeDue: true },
      },
    })
    const other = await prisma.company.create({ data: { name: 'Bureau Epsilon', slug: 'bureau-epsilon', siren: '970000102' } })
    const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
    const fy2026 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
    Object.assign(ids, { company: company.id, other: other.id, fy2025: fy2025.id, fy2026: fy2026.id })
    for (const [who, role] of [['owner', 'companyAdmin'], ['accountant', 'accountant'], ['viewer', 'viewer']] as const) {
      await prisma.user.create({ data: { ...USERS[who] } })
      await seedMembership(prisma, USERS[who].id, company.id, role)
    }
    await prisma.user.create({ data: { ...USERS.outsider } })
    await seedMembership(prisma, USERS.outsider.id, other.id, 'companyAdmin')

    // Facts of the other modules
    await prisma.vatReturnFiling.create({
      data: { companyId: company.id, form: 'CA3', periodKey: '2026-08', periodStart: day('2026-08-01'), periodEnd: day('2026-08-31'), filedOn: day('2026-09-18'), amountDue: 1_200, creditAmount: 0 },
    })
    await prisma.corporateTaxReturn.create({
      data: { companyId: company.id, fiscalYearId: fy2025.id, filedOn: day('2026-05-05'), resultBeforeDeficits: 40_000, deficitsImputed: 0, corporateTax: 6_000, reducedRate: true },
    })
    await prisma.corporateTaxReturn.create({
      data: { companyId: company.id, fiscalYearId: fy2026.id, acomptesPaid: [{ number: 1, paidOn: '2026-03-13', amountCents: 150_000 }] },
    })
    await prisma.accountsApproval.create({ data: { companyId: company.id, fiscalYearId: fy2025.id, details: {}, approvedOn: day('2026-06-20') } })
    await prisma.localTaxYear.create({ data: { companyId: company.id, year: 2025, cfeTotal: 3_500 } })
    ids.ownReceipt = (await prisma.attachment.create({ data: { companyId: company.id, fileName: 'avis-cfe-2026.pdf' } })).id
    ids.otherReceipt = (await prisma.attachment.create({ data: { companyId: other.id, fileName: 'secret.pdf' } })).id
  }, 120_000)

  afterAll(async () => {
    vi.useRealTimers()
    await prisma?.$disconnect()
  })

  it('reads the statuses from the VAT, IS and approval records, and the CFE acompte from the avis of 2025', async () => {
    const byId = await calendar()
    expect(byId.get('tva-ca3:2026-08')?.status).toMatchObject({ status: 'paid', filedOn: '2026-09-18', paidOn: '2026-09-18', filedFrom: 'vat-return', amountCents: 120_000, settled: true })
    expect(byId.get('tva-ca3:2026-09')?.status).toMatchObject({ status: 'todo', settled: false, locked: ['filedOn', 'paidOn'] })
    expect(byId.get('is-acompte:2026-12-31:1')?.status).toMatchObject({ status: 'paid', paidOn: '2026-03-13', paidFrom: 'corporate-tax' })
    expect(byId.get('is-acompte:2026-12-31:2')?.status).toMatchObject({ status: 'overdue', label: 'En retard' })
    expect(byId.get('liasse:2025-12-31')?.status).toMatchObject({ status: 'filed', filedOn: '2026-05-05', settled: true })
    expect(byId.get('approbation:2025-12-31')?.status).toMatchObject({ status: 'filed', label: 'Approuvés' })
    expect(byId.get('depot-comptes:2025-12-31')?.status).toMatchObject({ status: 'overdue' })
    expect(byId.get('cfe-acompte:2026')).toMatchObject({ date: '2026-06-15', status: { status: 'overdue', kind: 'pay' } })
    expect(byId.get('cfe:2026')?.status.status).toBe('todo')
    expect(byId.get('cvae:2025')?.status).toMatchObject({ status: 'overdue', kind: 'file' })
  })

  it('marks a payment for administrators and accountants only, and the calendar follows', async () => {
    expect((await mark('viewer', { deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12' })).status).toBe(403)
    expect((await mark('outsider', { deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12' })).status).toBe(404)
    expect((await mark('anonymous', { deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12' })).status).toBe(401)

    const response = await mark('accountant', { deadlineId: 'cfe-acompte:2026', paidOn: '2026-06-12', amountCents: 175_000, attachmentId: ids.ownReceipt, attachmentReference: 'Télépaiement 4321' })
    expect(response.status).toBe(200)
    const tracked = (await response.json()) as TrackedDeadline
    expect(tracked.status).toMatchObject({ status: 'paid', paidOn: '2026-06-12', amountCents: 175_000, paidFrom: 'tracker', settled: true })
    expect(tracked.status.record).toMatchObject({ attachmentId: ids.ownReceipt, attachmentName: 'avis-cfe-2026.pdf', attachmentReference: 'Télépaiement 4321' })
    expect((await calendar()).get('cfe-acompte:2026')?.status.status).toBe('paid')
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith('info', expect.stringContaining('cfe-acompte:2026'), expect.objectContaining({ action: 'MARK_DECLARATION', companyId: ids.company }))
  })

  it('refuses what another page records, with that page; a note stays possible', async () => {
    const vat = await mark('owner', { deadlineId: 'tva-ca3:2026-09', filedOn: '2026-10-01' })
    expect(vat.status).toBe(409)
    const body = (await vat.json()) as { error: string; page?: string }
    expect(body.error).toMatch(/Déclarations de TVA/)
    const liasse = await mark('owner', { deadlineId: 'liasse:2025-12-31', filedOn: '2026-05-01' })
    expect(liasse.status).toBe(409)
    expect(((await liasse.json()) as { error: string }).error).toMatch(/Impôt sur les sociétés/)
    expect((await mark('owner', { deadlineId: 'is-acompte:2026-12-31:3', paidOn: '2026-09-15' })).status).toBe(409)
    expect((await mark('owner', { deadlineId: 'approbation:2025-12-31', filedOn: '2026-06-01' })).status).toBe(409)

    const note = await mark('owner', { deadlineId: 'tva-ca3:2026-09', note: 'Prélèvement prévu le 19' })
    expect(note.status).toBe(200)
    expect(((await note.json()) as TrackedDeadline).status).toMatchObject({ status: 'todo', record: { note: 'Prélèvement prévu le 19' } })
    // A conditional IS acompte under its threshold: not due, though its payment is recorded on the IS page
    const notDue = await mark('owner', { deadlineId: 'is-acompte:2026-12-31:2', notDue: true })
    expect(((await notDue.json()) as TrackedDeadline).status).toMatchObject({ status: 'not-due', settled: true })
  })

  it('validates the dates, the kind of deadline, the deadline itself and the receipt', async () => {
    const expectError = async (body: Record<string, unknown>, status: number, message: RegExp) => {
      const response = await mark('owner', body)
      expect(response.status, JSON.stringify(body)).toBe(status)
      expect(((await response.json()) as { error: string }).error).toMatch(message)
    }
    await expectError({ deadlineId: 'cfe:2026', filedOn: '2026-10-01' }, 400, /paiement/)
    await expectError({ deadlineId: 'cvae:2025', paidOn: '2026-05-01' }, 400, /date de dépôt/)
    await expectError({ deadlineId: 'cfe:2026', paidOn: '2026-12-15' }, 400, /futur/)
    await expectError({ deadlineId: 'cfe:2026', paidOn: '2026-10-01', amountCents: -1 }, 400, /négatif/)
    await expectError({ deadlineId: 'cfe:1999', paidOn: '2026-10-01' }, 404, /Échéance inconnue/)
    await expectError({ deadlineId: 'pas une échéance', paidOn: '2026-10-01' }, 400, /Échéance inconnue/)
    await expectError({ deadlineId: 'cfe:2026', paidOn: '2026-10-01', attachmentId: ids.otherReceipt }, 400, /Pièce justificative introuvable/)
    expect(await prisma.declarationStatus.count({ where: { companyId: ids.company, deadlineId: 'cfe:2026' } })).toBe(0)
  })

  it('changes only the fields sent, then removes the record', async () => {
    const solde = 'cvae-solde:2025'
    let tracked = (await (await mark('owner', { deadlineId: solde, filedOn: '2026-05-04', amountCents: 80_000 })).json()) as TrackedDeadline
    expect(tracked.status).toMatchObject({ status: 'overdue', filedOn: '2026-05-04', settled: false })
    tracked = (await (await mark('owner', { deadlineId: solde, paidOn: '2026-05-04' })).json()) as TrackedDeadline
    expect(tracked.status).toMatchObject({ status: 'paid', filedOn: '2026-05-04', paidOn: '2026-05-04', amountCents: 80_000, settled: true })

    const removed = await call('owner', routes.status.DELETE, 'DELETE', `${statusPath()}?deadlineId=${solde}`)
    expect(removed.status).toBe(200)
    expect(((await removed.json()) as TrackedDeadline).status.status).toBe('overdue')
    expect((await call('owner', routes.status.DELETE, 'DELETE', `${statusPath()}?deadlineId=${solde}`)).status).toBe(404)
    expect((await call('viewer', routes.status.DELETE, 'DELETE', `${statusPath()}?deadlineId=${solde}`)).status).toBe(403)

    // Clearing every field deletes the row
    await mark('owner', { deadlineId: 'cvae:2025', filedOn: '2026-05-10' })
    expect(await prisma.declarationStatus.count({ where: { companyId: ids.company, deadlineId: 'cvae:2025' } })).toBe(1)
    await mark('owner', { deadlineId: 'cvae:2025', filedOn: null })
    expect(await prisma.declarationStatus.count({ where: { companyId: ids.company, deadlineId: 'cvae:2025' } })).toBe(0)
  })

  it('reads the facts and the tracker of one company only, in the order of the deadlines', async () => {
    const context = await deadlinesSvc.loadDeadlineContext(ids.company)
    const { computeDeadlines } = await import('@/lib/deadlines/engine')
    const deadlines = computeDeadlines({ ...context, from: '2026-06-01', to: '2026-06-30' })
    const tracked = await statuses.trackDeadlines(ids.company, context, deadlines, '2026-10-05')
    expect(tracked.map((d) => d.id)).toEqual(deadlines.map((d) => d.id))
    expect(tracked.find((d) => d.id === 'cfe-acompte:2026')?.status).toMatchObject({ status: 'paid', paidOn: '2026-06-12' })
    const data = await statuses.loadSourceData(ids.company, context, deadlines)
    expect(data.vatFilings.size).toBe(0) // no CA3 of May in this window: only the periods asked are read
    expect(data.corporateTax.get('2026-12-31')).toMatchObject({ fiscalYearId: ids.fy2026, acomptesPaid: [{ number: 1, paidOn: '2026-03-13', amountCents: 150_000 }] })
    expect(data.localTaxes.get(2025)).toEqual({ cfeTotalCents: 350_000, cfeAcompteCents: null })
    // The other company's records are never read
    await prisma.declarationStatus.create({ data: { companyId: ids.other, deadlineId: 'cfe:2026', paidOn: day('2026-09-01') } })
    expect((await statuses.loadTrackerRecords(ids.company, ['cfe:2026'])).size).toBe(0)
    expect((await statuses.loadTrackerRecords(ids.company, [])).size).toBe(0)
  })

  it('lists what is left to do on the simple home, in plain words', async () => {
    const home = await simpleHome.loadSimpleHome(ids.company, { can: () => true, now: NOW })
    const todo = home.todo.declarations ?? []
    expect(todo.length).toBeGreaterThan(0)
    expect(todo.length).toBeLessThanOrEqual(simpleHome.MAX_DECLARATIONS_TO_DO)
    // Settled deadlines never appear: the paid CFE acompte, the filed liasse
    expect(todo.map((d) => d.id)).not.toContain('cfe-acompte:2026')
    expect(todo.map((d) => d.id)).not.toContain('tva-ca3:2026-08')
    expect(todo.find((d) => d.id === 'tva-ca3:2026-09')).toMatchObject({ status: 'todo', date: '2026-10-19' })
    const none = await simpleHome.loadSimpleHome(ids.company, { can: (p) => !('reports' in p), now: NOW })
    expect(none.todo.declarations).toBeNull()
  })

  it('refuses rows the database forbids, whatever the code path', async () => {
    const base = { companyId: ids.company, deadlineId: 'das2:2025' }
    await expect(prisma.declarationStatus.create({ data: { ...base, notDue: true, paidOn: day('2026-05-01') } })).rejects.toThrow()
    await expect(prisma.declarationStatus.create({ data: { ...base } })).rejects.toThrow()
    await expect(prisma.declarationStatus.create({ data: { ...base, deadlineId: 'DROP TABLE', note: 'x' } })).rejects.toThrow()
    await expect(prisma.declarationStatus.create({ data: { ...base, paidOn: day('2026-05-01'), amount: -1 } })).rejects.toThrow()
    await prisma.declarationStatus.create({ data: { ...base, note: 'Rien versé en 2025' } })
    await expect(prisma.declarationStatus.create({ data: { ...base, note: 'doublon' } })).rejects.toThrow()
  })
})
