/**
 * Entry routes beyond the life cycle, against PostgreSQL (session and roles
 * mocked): reading, duplicating, reversing without a body, bulk deletion and
 * validation, the next number, and the validation of request bodies.
 * Skipped without the test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const member = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('entry_operations')
  return { companyId: '' }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === member.companyId ? ['accountant'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { writeAuditLog } from '@/lib/audit'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Routes = Record<string, Handler>
let prisma: typeof import('@/lib/prisma').prisma
const r = {} as Record<'entries' | 'entry' | 'duplicate' | 'reverse' | 'bulkValidate' | 'bulkDelete' | 'nextNumber', Routes>
const ids = {} as Record<string, string>

function call(handler: Handler, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, params ? { params: Promise.resolve(params) } : undefined)
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown> & { error?: string }
}

/** Creates an entry through the API and returns it. */
async function entry(status: 'draft' | 'validated', date = '2025-06-30', amount = '10.00') {
  const response = await call(r.entries.POST, 'POST', '/api/entries', {
    companyId: ids.company,
    journalId: ids.journal,
    date,
    description: `Vente ${date}`,
    reference: 'F-1',
    status,
    lines: [
      { accountId: ids.bank, debit: amount, credit: 0, description: 'Encaissement' },
      { accountId: ids.sales, debit: 0, credit: amount },
    ],
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string; entryNumber: string; status: string }
}

describe.skipIf(!available)('entry operations routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('entry_operations')
    ;({ prisma } = await import('@/lib/prisma'))
    Object.assign(r, {
      entries: await import('@/app/api/entries/route'),
      entry: await import('@/app/api/entries/[id]/route'),
      duplicate: await import('@/app/api/entries/[id]/duplicate/route'),
      reverse: await import('@/app/api/entries/[id]/reverse/route'),
      bulkValidate: await import('@/app/api/entries/bulk-validate/route'),
      bulkDelete: await import('@/app/api/entries/bulk-delete/route'),
      nextNumber: await import('@/app/api/entries/next-number/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('entry_operations')
    vi.mocked(writeAuditLog).mockClear()
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    // The mocked session user is a member in the database too (row level security).
    await seedMembership(prisma, 'user-1', company.id)
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    member.companyId = company.id
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
    })
    const otherFy = await prisma.fiscalYear.create({
      data: { companyId: other.id, year: 2025, startDate: new Date('2025-01-01T00:00:00Z'), endDate: new Date('2025-12-31T00:00:00Z') },
    })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'VT', label: 'Ventes' } })
    const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
    const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
    const otherJournal = await prisma.journal.create({ data: { companyId: other.id, code: 'VT', label: 'Ventes' } })
    const foreignEntry = await prisma.accountingEntry.create({
      data: {
        companyId: other.id,
        fiscalYearId: otherFy.id,
        journalId: otherJournal.id,
        entryNumber: 'BR-x',
        date: new Date('2025-03-01T00:00:00Z'),
        status: 'draft',
      },
    })
    Object.assign(ids, { company: company.id, fy: fy.id, journal: journal.id, bank: bank.id, sales: sales.id, foreignEntry: foreignEntry.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('validates the entry body with French messages', async () => {
    const base = { companyId: ids.company, journalId: ids.journal, date: '2025-06-30', lines: [] as unknown }
    const notAList = await call(r.entries.POST, 'POST', '/api/entries', { ...base, lines: 'x' })
    expect(notAList.status).toBe(400)
    expect((await json(notAList)).error).toBe('lines: Les lignes doivent être une liste')

    const noJournal = await call(r.entries.POST, 'POST', '/api/entries', { companyId: ids.company, date: '2025-06-30', lines: [] })
    expect((await json(noJournal)).error).toBe('journalId: Le journal est requis')

    const badStatus = await call(r.entries.POST, 'POST', '/api/entries', { ...base, status: 'posted' })
    expect((await json(badStatus)).error).toBe('status: Le statut doit être "draft" ou "validated"')

    const badAmount = await call(r.entries.POST, 'POST', '/api/entries', {
      ...base,
      lines: [{ accountId: ids.bank, debit: '1.234', credit: 0 }, { accountId: ids.sales, debit: 0, credit: '1.234' }],
    })
    expect(badAmount.status).toBe(400)
    expect((await json(badAmount)).error).toMatch(/montant invalide/)
    expect(await prisma.accountingEntry.count({ where: { companyId: ids.company } })).toBe(0)
  })

  it('reads an entry of the company and answers 404 for another company', async () => {
    const draft = await entry('draft')
    const got = await call(r.entry.GET, 'GET', `/api/entries/${draft.id}`, undefined, { id: draft.id })
    expect(got.status).toBe(200)
    expect(await json(got)).toMatchObject({ id: draft.id, journal: { code: 'VT' }, lines: [{ account: { code: '512000' } }, { account: { code: '706000' } }] })
    const foreign = await call(r.entry.GET, 'GET', `/api/entries/${ids.foreignEntry}`, undefined, { id: ids.foreignEntry })
    expect(foreign.status).toBe(404)
  })

  it('edits a draft through PATCH and checks the body', async () => {
    const draft = await entry('draft')
    const patch = (body: unknown) => call(r.entry.PATCH, 'PATCH', `/api/entries/${draft.id}`, body, { id: draft.id })

    const edited = await patch({ reference: 'F-2', lines: [{ accountId: ids.bank, debit: 20, credit: 0 }, { accountId: ids.sales, debit: 0, credit: '20' }] })
    expect(edited.status).toBe(200)
    expect(await json(edited)).toMatchObject({ reference: 'F-2', status: 'draft' })
    const stored = await prisma.entryLine.findMany({ where: { accountingEntryId: draft.id }, orderBy: { createdAt: 'asc' } })
    expect(stored.map((l) => [l.debit.toString(), l.credit.toString()])).toEqual([['20', '0'], ['0', '20']])

    expect((await json(await patch({ status: 'archived' }))).error).toBe('status: Le statut doit être "draft" ou "validated"')
    expect((await patch({ lines: [{ debit: 1 }] })).status).toBe(400)
  })

  it('duplicates an entry as a draft with the same lines', async () => {
    const validated = await entry('validated')
    const response = await call(r.duplicate.POST, 'POST', `/api/entries/${validated.id}/duplicate`, undefined, { id: validated.id })
    expect(response.status).toBe(201)
    const copy = (await response.json()) as { id: string; status: string; entryNumber: string; reference: string; lines: Array<{ debit: string; description: string | null }> }
    expect(copy).toMatchObject({ status: 'draft', reference: 'F-1' })
    expect(copy.entryNumber).toMatch(/^BR-/)
    expect(copy.lines.map((l) => [String(l.debit), l.description])).toEqual([['10', 'Encaissement'], ['0', null]])
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('duplicated'), expect.objectContaining({ action: 'DUPLICATE_ACCOUNTING_ENTRY' }))

    const foreign = await call(r.duplicate.POST, 'POST', `/api/entries/${ids.foreignEntry}/duplicate`, undefined, { id: ids.foreignEntry })
    expect(foreign.status).toBe(404)
  })

  it('reverses with an empty body (the original date) and refuses a date that is not text', async () => {
    const validated = await entry('validated', '2025-05-15')
    const wrong = await call(r.reverse.POST, 'POST', `/api/entries/${validated.id}/reverse`, { date: 20250515 }, { id: validated.id })
    expect(wrong.status).toBe(400)
    const reversal = await call(r.reverse.POST, 'POST', `/api/entries/${validated.id}/reverse`, undefined, { id: validated.id })
    expect(reversal.status).toBe(201)
    expect(await json(reversal)).toMatchObject({ date: '2025-05-15T00:00:00.000Z', reversalOfId: validated.id, status: 'validated' })
  })

  it('deletes drafts in bulk and reports each refusal', async () => {
    const draft = await entry('draft')
    const validated = await entry('validated')
    const response = await call(r.bulkDelete.POST, 'POST', '/api/entries/bulk-delete', {
      companyId: ids.company,
      entryIds: [draft.id, validated.id, ids.foreignEntry, 42],
    })
    expect(response.status).toBe(200)
    const result = await json(response)
    expect(result).toMatchObject({ success: true, deleted: 1, failed: 3, results: [{ entryId: draft.id, success: true }] })
    expect(result.errors).toEqual([
      { entryId: validated.id, error: expect.stringContaining('contre-passation') },
      { entryId: ids.foreignEntry, error: 'Écriture introuvable' },
      { entryId: 42, error: 'Écriture introuvable' },
    ])
    expect(await prisma.accountingEntry.findUnique({ where: { id: draft.id } })).toBeNull()
    expect(await prisma.accountingEntry.findUnique({ where: { id: ids.foreignEntry } })).not.toBeNull()

    const empty = await call(r.bulkDelete.POST, 'POST', '/api/entries/bulk-delete', { companyId: ids.company, entryIds: [] })
    expect(empty.status).toBe(400)
    expect((await json(empty)).error).toBe('entryIds: Sélectionnez au moins une écriture')
  })

  it('validates drafts in bulk in date order and refuses a return to draft', async () => {
    const late = await entry('draft', '2025-09-01')
    const early = await entry('draft', '2025-02-01')
    const response = await call(r.bulkValidate.POST, 'POST', '/api/entries/bulk-validate', {
      companyId: ids.company,
      entryIds: [late.id, early.id, ids.foreignEntry, ''],
      status: 'validated',
    })
    const result = await json(response)
    expect(result).toMatchObject({ success: true, validated: 2, failed: 2 })
    expect((result.results as Array<{ id: string; entryNumber: string }>).map((e) => [e.id, e.entryNumber])).toEqual([
      [early.id, '1'],
      [late.id, '2'],
    ])
    expect(result.errors).toEqual([
      { entryId: '', error: 'Écriture introuvable' },
      { entryId: ids.foreignEntry, error: 'Écriture introuvable' },
    ])

    const back = await json(await call(r.bulkValidate.POST, 'POST', '/api/entries/bulk-validate', { companyId: ids.company, entryIds: [early.id], status: 'draft' }))
    expect(back).toMatchObject({ validated: 0, failed: 1, results: [], errors: [{ entryId: early.id, error: expect.stringContaining('PCG art. 1031-3') }] })

    const noStatus = await call(r.bulkValidate.POST, 'POST', '/api/entries/bulk-validate', { companyId: ids.company, entryIds: [early.id] })
    expect(noStatus.status).toBe(400)
    expect((await json(noStatus)).error).toBe('status: Le statut doit être "draft" ou "validated"')
  })

  it('gives the next definitive number of the fiscal year of a date', async () => {
    const next = (query: string) => call(r.nextNumber.GET, 'GET', `/api/entries/next-number?companyId=${ids.company}${query}`)
    expect(await json(await next('&date=2025-04-01'))).toEqual({ nextNumber: '1' })
    await entry('validated')
    expect(await json(await next('&date=2025-04-01'))).toEqual({ nextNumber: '2' })
    expect((await next('&date=2025-13-01')).status).toBe(400)
  })
})
