/**
 * POST /api/journals/defaults against PostgreSQL (session and roles mocked):
 * adds back the default journals a company is missing (AC, VE, BQ, OD, AN,
 * lib/accounting/default-journals.ts), keeps the existing ones as they are,
 * creates nothing twice, and stays inside the company and the role. Skipped
 * without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const member = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('journal_defaults')
  return { companyId: '', role: 'companyAdmin' }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === member.companyId ? [member.role] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let POST: (request: NextRequest) => Promise<Response>
const ids = {} as Record<'company' | 'other', string>

function post(companyId: string) {
  return POST(
    new NextRequest('http://localhost/api/journals/defaults', {
      method: 'POST',
      body: JSON.stringify({ companyId }),
      headers: { 'content-type': 'application/json' },
    }),
  )
}

const journalsOf = async (companyId: string) =>
  (await prisma.journal.findMany({ where: { companyId }, orderBy: { code: 'asc' }, select: { code: true, label: true } })).map(
    (j) => `${j.code} ${j.label}`,
  )

describe.skipIf(!available)('POST /api/journals/defaults', () => {
  beforeAll(async () => {
    await prepareTestDatabase('journal_defaults')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ POST } = (await import('@/app/api/journals/defaults/route')) as unknown as { POST: typeof POST })
  })

  beforeEach(async () => {
    await prepareTestDatabase('journal_defaults')
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    // The mocked session user is a member in the database too (row level security).
    await seedMembership(prisma, 'user-1', company.id)
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    // The company deleted VE and AN and renamed its bank journal
    await prisma.journal.createMany({
      data: [
        { companyId: company.id, code: 'AC', label: 'Achats' },
        { companyId: company.id, code: 'BQ', label: 'Banque Qonto' },
        { companyId: company.id, code: 'OD', label: 'Opérations diverses' },
        { companyId: company.id, code: 'BQ2', label: 'Banque 2' },
      ],
    })
    Object.assign(ids, { company: company.id, other: other.id })
    member.companyId = company.id
    member.role = 'companyAdmin'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates the missing default journals only, and returns them with the full list', async () => {
    const response = await post(ids.company)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { created: string[]; journals: Array<{ code: string; label: string }> }
    expect(body.created).toEqual(['VE', 'AN'])
    expect(body.journals.map((j) => j.code)).toEqual(['AC', 'AN', 'BQ', 'BQ2', 'OD', 'VE'])
    expect(await journalsOf(ids.company)).toEqual([
      'AC Achats',
      'AN À-nouveaux',
      'BQ Banque Qonto',
      'BQ2 Banque 2',
      'OD Opérations diverses',
      'VE Ventes',
    ])
  })

  it('creates nothing the second time, even when called twice at once', async () => {
    const [first, second] = await Promise.all([post(ids.company), post(ids.company)])
    expect([first.status, second.status]).toEqual([200, 200])
    expect((await journalsOf(ids.company)).length).toBe(6)
    const again = (await (await post(ids.company)).json()) as { created: string[] }
    expect(again.created).toEqual([])
    expect((await journalsOf(ids.company)).length).toBe(6)
  })

  it('refuses a viewer (403) and another company (404) without creating anything', async () => {
    member.role = 'viewer'
    expect((await post(ids.company)).status).toBe(403)
    member.role = 'companyAdmin'
    expect((await post(ids.other)).status).toBe(404)
    expect(await journalsOf(ids.other)).toEqual([])
    expect((await journalsOf(ids.company)).length).toBe(4)
  })
})
