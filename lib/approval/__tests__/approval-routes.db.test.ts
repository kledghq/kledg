/**
 * Approval of the accounts against PostgreSQL (session mocked, roles from
 * member rows):
 * - GET /api/companies/[id]/fiscal-years/[fiscalYearId]/approval: the pack of
 *   a SARL built from the books (result of the year, legal reserve of
 *   L232-10), the shareholders and the saved details; every member reads it;
 * - PUT: closing:execute only, validated (French messages), scoped to the
 *   company's own shareholders, stored once per fiscal year, audited;
 * - GET .../documents/[document]?format=: the minutes in Markdown and PDF
 *   (reports:export), 400 listing what is missing, 404 for a document that
 *   is not part of the pack;
 * - the deadline calendar counts the filing from the recorded approval;
 * - a member of another company gets 404, an anonymous request 401.
 *
 * Runs under KLEDG_RLS=enforce too (the whole suite does in CI).
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('approval')
  return { user: null as null | { id: string; email: string; name: string; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { ApprovalView } from '../get-approval.service'
import type { DeadlinesView } from '@/lib/deadlines/load-deadlines.service'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
let approvalRoute: Record<'GET' | 'PUT', Handler>
let documentRoute: Record<'GET', Handler>
let deadlinesRoute: Record<'GET', Handler>

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
    data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111', legalType: 'SARL', corporateTaxRegime: 'simplified', shareCapital: 10000, totalShares: 1000 },
  })
  const address = await prisma.address.create({ data: { companyId: company.id, street: '2 rue Neuve', postalCode: '69001', city: 'Lyon' } })
  await prisma.company.update({ where: { id: company.id }, data: { headquartersAddressId: address.id } })
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
  const jeanne = await prisma.person.create({ data: { companyId: company.id, firstName: 'Jeanne', name: 'Martin' } })
  const h1 = await prisma.shareholder.create({ data: { companyId: company.id, type: 'PHYSICAL', personId: jeanne.id, sharePercentage: 60, numberOfShares: 600 } })
  const h2 = await prisma.shareholder.create({ data: { companyId: company.id, type: 'LEGAL', name: 'Holding Beta', sharePercentage: 40, numberOfShares: 400 } })
  const foreign = await prisma.shareholder.create({ data: { companyId: other.id, type: 'LEGAL', name: 'Ailleurs', sharePercentage: 100, numberOfShares: 10 } })

  const fy2025 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })
  const fy2026 = await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  const otherFy = await prisma.fiscalYear.create({ data: { companyId: other.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31') } })

  // Books of 2025: capital 10 000 €, sales 80 000 €, charges 30 000 €: profit 50 000 €.
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
  const account = async (code: string, label: string) => (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy2025.id, code, label } })).id
  const bank = await account('512000', 'Banque')
  const capital = await account('101000', 'Capital')
  const sales = await account('706000', 'Prestations de services')
  const charges = await account('622600', 'Honoraires')
  let n = 0
  const entry = async (date: string, lines: Array<[string, number, number]>) => {
    n++
    const e = await prisma.accountingEntry.create({
      data: { companyId: company.id, fiscalYearId: fy2025.id, journalId: journal.id, entryNumber: String(n), date: day(date), description: `Écriture ${n}`, status: 'draft' },
    })
    await prisma.entryLine.createMany({
      data: lines.map(([accountId, debit, credit]) => ({ accountingEntryId: e.id, accountId, accountFiscalYearId: fy2025.id, accountingEntryNumber: String(n), debit, credit })),
    })
    await prisma.accountingEntry.update({ where: { id: e.id }, data: { status: 'validated' } })
  }
  await entry('2025-01-02', [[bank, 10000, 0], [capital, 0, 10000]])
  await entry('2025-06-30', [[bank, 80000, 0], [sales, 0, 80000]])
  await entry('2025-09-30', [[charges, 30000, 0], [bank, 0, 30000]])

  Object.assign(ids, { company: company.id, other: other.id, fy2025: fy2025.id, fy2026: fy2026.id, otherFy: otherFy.id, h1: h1.id, h2: h2.id, foreign: foreign.id })
}

const COMPLETE = {
  rcsCity: 'Lyon',
  signatureCity: 'Lyon',
  meeting: { date: '2026-06-15', time: '10 h 00', place: 'au siège social', convocationDate: '2026-05-29' },
  chair: { name: 'Jeanne Martin' },
  officers: [{ name: 'Jeanne Martin' }],
  votes: { approval: { unanimous: true }, agreements: { unanimous: true }, allocation: { unanimous: true }, powers: { unanimous: true } },
  allocation: { dividendsCents: 2_000_000 },
  priorDividends: [
    { year: 2024, amountCents: 0 },
    { year: 2023, amountCents: 0 },
    { year: 2022, amountCents: 0 },
  ],
  nonDeductibleExpensesCents: 0,
  regulatedAgreements: 'none',
  hasAuditor: false,
  size: { category: 'micro', employees: 2 },
  groupMember: false,
  confidentiality: 'full',
  approvedOn: '2026-06-15',
}

describe.skipIf(!available)('approval of the accounts routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('approval')
    ;({ prisma } = await import('@/lib/prisma'))
    approvalRoute = (await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/approval/route')) as unknown as typeof approvalRoute
    documentRoute = (await import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/approval/documents/[document]/route')) as unknown as typeof documentRoute
    deadlinesRoute = (await import('@/app/api/deadlines/route')) as unknown as typeof deadlinesRoute
    await seed()
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  const path = (fy = ids.fy2025, company = ids.company) => `/api/companies/${company}/fiscal-years/${fy}/approval`
  const params = (fy = ids.fy2025, company = ids.company) => ({ id: company, fiscalYearId: fy })
  const read = async (who: Who) => {
    const response = await call(who, approvalRoute.GET, 'GET', path(), params())
    expect(response.status).toBe(200)
    return (await response.json()) as ApprovalView
  }
  const attendance = () => [
    { shareholderId: ids.h1, status: 'present' },
    { shareholderId: ids.h2, status: 'represented', proxy: 'Paul Durand' },
  ]
  const doc = (who: Who, document: string, format = 'md') =>
    call(who, documentRoute.GET, 'GET', `${path()}/documents/${document}?format=${format}`, { ...params(), document })

  it('reads the pack of a SARL from the books and the shareholders, before anything is saved', async () => {
    const view = await read('viewer')
    expect(view.saved).toBeNull()
    expect(view.pack.regime).toMatchObject({ form: 'SARL', officerTitle: { singular: 'gérant' } })
    expect(view.pack.resultCents).toBe(5_000_000)
    // L232-10: 5 % of the profit, capped at a tenth of the 10 000 € capital booked in 101.
    expect(view.pack.plan.legalReserveCents).toBe(100_000)
    expect(view.context.company.address).toBe('2 rue Neuve, 69001 Lyon')
    expect(view.context.holders.map((h) => [h.name, h.shares])).toEqual([
      ['Jeanne Martin', 600],
      ['Holding Beta', 400],
    ])
    expect(view.persons).toEqual([{ id: expect.any(String), name: 'Jeanne Martin' }])
    expect(view.pack.deadlines).toMatchObject({ approval: '2026-06-30', filing: '2026-07-31' })
    expect(view.pack.documents.find((d) => d.id === 'decision')?.missing).toContain('Ville du greffe (RCS) où la société est immatriculée')
    expect(view.pack.warnings.join(' ')).toMatch(/n'est pas clôturé/)
    expect(view.sources.map((s) => s.label)).toContain('C. com., art. L223-26')
  })

  it('refuses the save to a viewer and validates the details', async () => {
    expect((await call('viewer', approvalRoute.PUT, 'PUT', path(), params(), COMPLETE)).status).toBe(403)
    const bad = await call('accountant', approvalRoute.PUT, 'PUT', path(), params(), { ...COMPLETE, meeting: { date: '15/06/2026' } })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toMatch(/AAAA-MM-JJ/)
    const early = await call('accountant', approvalRoute.PUT, 'PUT', path(), params(), { ...COMPLETE, meeting: { date: '2025-12-15' } })
    expect(early.status).toBe(400)
    expect(((await early.json()) as { error: string }).error).toMatch(/postérieure à la clôture/)
    const foreign = await call('accountant', approvalRoute.PUT, 'PUT', path(), params(), { ...COMPLETE, attendance: [{ shareholderId: ids.foreign, status: 'present' }] })
    expect(foreign.status).toBe(400)
    expect(((await foreign.json()) as { error: string }).error).toMatch(/n'est pas enregistré pour cette société/)
    expect(await prisma.accountsApproval.count()).toBe(0)
  })

  it('saves once per fiscal year, copies the approval day out and writes an audit row', async () => {
    const first = await call('accountant', approvalRoute.PUT, 'PUT', path(), params(), { ...COMPLETE, attendance: attendance() })
    expect(first.status).toBe(200)
    const view = (await first.json()) as ApprovalView
    expect(view.saved).not.toBeNull()
    // The annexe (lib/annexe) asks its own answers: a micro-entreprise only mentions commitments and advances (PCG art. 811-7)
    expect(view.pack.documents.filter((d) => d.missing.length > 0 && d.id !== 'annexe').map((d) => [d.id, d.missing])).toEqual([])
    expect(view.pack.documents.find((d) => d.id === 'annexe')).toMatchObject({ title: 'Informations à la suite du bilan', required: false })
    expect(view.pack.documents.map((d) => d.id).slice(-2)).toEqual(['annexe', 'filing-checklist'])
    expect(view.pack.resolutions.every((r) => r.outcome.adopted === true)).toBe(true)
    expect(view.pack.deadlines).toMatchObject({ filing: '2026-07-15', filingBasis: 'approval' })

    const again = await call('owner', approvalRoute.PUT, 'PUT', path(), params(), { ...COMPLETE, attendance: attendance(), filedOn: '2026-07-01' })
    expect(again.status).toBe(200)
    const rows = await prisma.accountsApproval.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ companyId: ids.company, fiscalYearId: ids.fy2025, approvedOn: day('2026-06-15'), filedOn: day('2026-07-01') })
    expect(await prisma.auditLog.count({ where: { companyId: ids.company, action: 'SAVE_ACCOUNTS_APPROVAL' } })).toBe(2)
  })

  it('generates the minutes in Markdown and PDF for members with reports:export', async () => {
    const md = await doc('accountant', 'decision', 'md')
    expect(md.status).toBe(200)
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/)
    expect(md.headers.get('content-disposition')).toMatch(/Proces_verbal_Atelier_Lumen_2025\.md/)
    const text = await md.text()
    expect(text).toContain("# Procès-verbal de l'assemblée générale ordinaire annuelle")
    expect(text).toContain('à la réserve légale : 1 000,00 €')
    expect(text).toContain('Holding Beta | 400 | Représenté par Paul Durand')
    expect(text).toContain('111 111 111 RCS Lyon')

    const pdf = await doc('owner', 'decision', 'pdf')
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')

    for (const id of ['convocation', 'attendance', 'confidentiality', 'filing-checklist']) {
      expect((await doc('owner', id)).status, id).toBe(200)
    }
    expect((await doc('viewer', 'decision')).status).toBe(403)
    expect((await doc('owner', 'unknown')).status).toBe(404)
    // A micro SARL is exempt from the management report (L232-1 IV): not part of the pack unless asked.
    expect((await doc('owner', 'management-report')).status).toBe(404)
  })

  it('answers 400 with the list of what is missing', async () => {
    await call('owner', approvalRoute.PUT, 'PUT', path(), params(), { ...COMPLETE, attendance: attendance(), rcsCity: null })
    const response = await doc('owner', 'decision')
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string; missing: string[] }
    expect(body.error).toMatch(/^Complétez d'abord\u00a0: /)
    expect(body.missing).toContain('Ville du greffe (RCS) où la société est immatriculée')
  })

  it('feeds the deadline calendar with the recorded approval', async () => {
    const response = await call('viewer', deadlinesRoute.GET, 'GET', `/api/deadlines?companyId=${ids.company}&fiscalYearId=${ids.fy2026}`)
    expect(response.status).toBe(200)
    const view = (await response.json()) as DeadlinesView
    const filing = view.deadlines.find((d) => d.id === 'depot-comptes:2025-12-31')
    // The last save has no filing day: one month after the approval of 15 June.
    expect(filing).toMatchObject({ date: '2026-07-15', note: "Un mois après l'approbation du 15/06/2026 (deux mois en cas de dépôt en ligne)." })
    expect(view.deadlines.find((d) => d.id === 'approbation:2025-12-31')?.note).toBe('Comptes approuvés le 15/06/2026.')
  })

  it('hides another company: 404 for a non-member and for a fiscal year of another company, 401 anonymous', async () => {
    expect((await call('outsider', approvalRoute.GET, 'GET', path(), params())).status).toBe(404)
    expect((await call('outsider', approvalRoute.PUT, 'PUT', path(), params(), COMPLETE)).status).toBe(404)
    expect((await call('owner', approvalRoute.GET, 'GET', path(ids.otherFy), params(ids.otherFy))).status).toBe(404)
    expect((await call('owner', approvalRoute.PUT, 'PUT', path(ids.otherFy), params(ids.otherFy), COMPLETE)).status).toBe(404)
    expect((await call('anonymous', approvalRoute.GET, 'GET', path(), params())).status).toBe(401)
    expect(await prisma.accountsApproval.count({ where: { companyId: ids.other } })).toBe(0)
  })
})
