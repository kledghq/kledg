/**
 * Routes of the year-end work (provisions, impairments, investment grants,
 * year-end entries) and of the capital composition, against PostgreSQL with
 * only the session mocked (roles come from the members of the database):
 * status codes, French messages, input validation, the roles (an accountant
 * records and prepares, a read-only member reads), another company's rows
 * answered as missing, and no personal data in the capital composition.
 * The authorization matrix covers every role on every route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('year_end_routes')
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { seedBooks, type Books } from '@/lib/invoices/__tests__/helpers/books'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let svc: typeof import('@/lib/accounting/services/entry-lifecycle.service')
const routes = {} as Record<string, Module>

const USERS = {
  accountant: { id: 'u-acc', email: 'acc@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-view', email: 'view@test.local', name: 'Lecture', role: 'user' },
  outsider: { id: 'u-out', email: 'out@test.local', name: 'Autre société', role: 'user' },
}

async function call(as: keyof typeof USERS, route: string, method: string, path: string, body?: unknown, params: Record<string, string> = {}) {
  state.user = USERS[as]
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve(params) })
}

const PROVISION = {
  category: 'RISK_CHARGE',
  label: 'Garantie des ventes',
  justification: 'Retours sous garantie de 2 % du chiffre d’affaires constatés sur trois ans.',
  accountCode: '1512',
  openedOn: '2026-01-01',
}

describe.skipIf(!available)('year-end routes (PostgreSQL)', () => {
  let books: Books
  let other: Books

  beforeAll(async () => {
    await prepareTestDatabase('year_end_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    svc = await import('@/lib/accounting/services/entry-lifecycle.service')
    Object.assign(routes, {
      provisions: await import('@/app/api/provisions/route'),
      provision: await import('@/app/api/provisions/[id]/route'),
      assessment: await import('@/app/api/provisions/[id]/assessment/route'),
      doubtful: await import('@/app/api/provisions/doubtful-receivables/route'),
      reclassify: await import('@/app/api/provisions/doubtful-receivables/reclassify/route'),
      grants: await import('@/app/api/investment-grants/route'),
      grant: await import('@/app/api/investment-grants/[id]/route'),
      yearEnd: await import('@/app/api/year-end/route'),
      entries: await import('@/app/api/year-end/entries/route'),
      capital: await import('@/app/api/reports/capital-composition/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('year_end_routes')
    books = await seedBooks(prisma, svc, { siren: '940000601', slug: 'routes-year-end' })
    other = await seedBooks(prisma, svc, { siren: '940000602', slug: 'routes-year-end-b' })
    await seedMembership(prisma, USERS.accountant.id, books.companyId, 'accountant')
    await seedMembership(prisma, USERS.viewer.id, books.companyId, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, other.companyId, 'companyAdmin')
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lets an accountant record, assess and prepare a provision, and a read-only member read it', async () => {
    const created = await call('accountant', 'provisions', 'POST', '/api/provisions', { companyId: books.companyId, ...PROVISION })
    expect(created.status).toBe(201)
    const provision = await created.json()
    expect(provision).toMatchObject({ accountCode: '1512', nature: 'OPERATING', taxDeductible: true })

    const forbidden = await call('viewer', 'provisions', 'POST', '/api/provisions', { companyId: books.companyId, ...PROVISION })
    expect(forbidden.status).toBe(403)

    const assessed = await call('accountant', 'assessment', 'PUT', `/api/provisions/${provision.id}/assessment`, { fiscalYearId: books.fiscalYearId, amountCents: 250_000, basis: '2 % des ventes' }, { id: provision.id })
    expect(assessed.status).toBe(200)
    expect(await assessed.json()).toMatchObject({ amountCents: 250_000, currentValueCents: null })

    const list = await call('viewer', 'provisions', 'GET', `/api/provisions?companyId=${books.companyId}&fiscalYearId=${books.fiscalYearId}`)
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toContain('no-store')
    const body = await list.json()
    expect(body.fiscalYear).toMatchObject({ year: 2026, endDate: '2026-12-31' })
    expect(body.provisions).toEqual([expect.objectContaining({ id: provision.id, status: 'to_post', requiredCents: 250_000, proposedCents: 250_000 })])

    const prepared = await call('accountant', 'entries', 'POST', '/api/year-end/entries', { companyId: books.companyId, fiscalYearId: books.fiscalYearId })
    expect(prepared.status).toBe(201)
    const result = await prepared.json()
    expect(result.created).toEqual([expect.objectContaining({ kind: 'provision', itemId: provision.id, cents: 250_000 })])
    expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: result.created[0].entryId } })).status).toBe('draft')
    expect((await (await call('accountant', 'entries', 'POST', '/api/year-end/entries', { companyId: books.companyId, fiscalYearId: books.fiscalYearId })).json()).created).toEqual([])
    expect((await call('viewer', 'entries', 'POST', '/api/year-end/entries', { companyId: books.companyId, fiscalYearId: books.fiscalYearId })).status).toBe(403)

    const inventory = await (await call('viewer', 'yearEnd', 'GET', `/api/year-end?companyId=${books.companyId}&fiscalYearId=${books.fiscalYearId}`)).json()
    expect(inventory.provisions[0]).toMatchObject({ status: 'draft', entry: { status: 'draft', cents: 250_000 } })

    // Removing the assessment deletes its draft
    const removed = await call('accountant', 'assessment', 'DELETE', `/api/provisions/${provision.id}/assessment?fiscalYearId=${books.fiscalYearId}`, undefined, { id: provision.id })
    expect(removed.status).toBe(204)
    expect(await prisma.accountingEntry.count({ where: { id: result.created[0].entryId } })).toBe(0)

    const deleted = await call('accountant', 'provision', 'DELETE', `/api/provisions/${provision.id}`, undefined, { id: provision.id })
    expect(deleted.status).toBe(204)
  })

  it('answers invalid input with French messages', async () => {
    const wrongAccount = await call('accountant', 'provisions', 'POST', '/api/provisions', { companyId: books.companyId, ...PROVISION, accountCode: '491' })
    expect(wrongAccount.status).toBe(400)
    expect((await wrongAccount.json()).error).toBe('Le compte 491 ne convient pas : utilisez un compte 151 ou 152 pour ce type.')

    const missing = await call('accountant', 'provisions', 'POST', '/api/provisions', { companyId: books.companyId, ...PROVISION, label: '' })
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toMatch(/Le libellé est requis/)

    const created = await (await call('accountant', 'provisions', 'POST', '/api/provisions', { companyId: books.companyId, ...PROVISION })).json()
    const both = await call('accountant', 'assessment', 'PUT', `/api/provisions/${created.id}/assessment`, { fiscalYearId: books.fiscalYearId, amountCents: 1, currentValueCents: 1 }, { id: created.id })
    expect(both.status).toBe(400)
    expect((await both.json()).error).toMatch(/soit le montant requis, soit la valeur actuelle/)

    const noYear = await call('viewer', 'yearEnd', 'GET', `/api/year-end?companyId=${books.companyId}`)
    expect(noYear.status).toBe(400)
    const closed = await call('accountant', 'assessment', 'PUT', `/api/provisions/${created.id}/assessment`, { fiscalYearId: books.closedFiscalYearId, amountCents: 100 }, { id: created.id })
    expect(closed.status).toBe(409)
    const badThreshold = await call('viewer', 'doubtful', 'GET', `/api/provisions/doubtful-receivables?companyId=${books.companyId}&fiscalYearId=${books.fiscalYearId}&minDaysOverdue=45`)
    expect(badThreshold.status).toBe(400)
  })

  it("answers another company's provisions, grants and fiscal years as missing", async () => {
    const created = await (await call('accountant', 'provisions', 'POST', '/api/provisions', { companyId: books.companyId, ...PROVISION })).json()
    expect((await call('outsider', 'provision', 'DELETE', `/api/provisions/${created.id}`, undefined, { id: created.id })).status).toBe(404)
    expect((await call('outsider', 'provisions', 'GET', `/api/provisions?companyId=${books.companyId}&fiscalYearId=${books.fiscalYearId}`)).status).toBe(404)
    const foreignYear = await call('accountant', 'yearEnd', 'GET', `/api/year-end?companyId=${books.companyId}&fiscalYearId=${other.fiscalYearId}`)
    expect(foreignYear.status).toBe(404)
    const foreignAssessment = await call('accountant', 'assessment', 'PUT', `/api/provisions/${created.id}/assessment`, { fiscalYearId: other.fiscalYearId, amountCents: 100 }, { id: created.id })
    expect(foreignAssessment.status).toBe(404)
    expect(await prisma.provisionAssessment.count()).toBe(0)
  })

  it('records, changes and deletes an investment grant', async () => {
    const created = await call('accountant', 'grants', 'POST', '/api/investment-grants', {
      companyId: books.companyId,
      label: 'Subvention de la région',
      grantor: 'Région',
      amountCents: 500_000,
      grantedOn: '2026-05-01',
      spreading: 'INALIENABILITY',
      durationYears: 5,
    })
    expect(created.status).toBe(201)
    const grant = await created.json()
    const list = await (await call('viewer', 'grants', 'GET', `/api/investment-grants?companyId=${books.companyId}&fiscalYearId=${books.fiscalYearId}`)).json()
    expect(list.grants).toEqual([expect.objectContaining({ id: grant.id, status: 'to_post', proposedCents: 100_000, remainingCents: 400_000 })])

    const updated = await call('accountant', 'grant', 'PATCH', `/api/investment-grants/${grant.id}`, { label: 'Subvention de la région', amountCents: 500_000, grantedOn: '2026-05-01', spreading: 'TENTHS' }, { id: grant.id })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ spreading: 'TENTHS', durationYears: null })
    const invalid = await call('accountant', 'grant', 'PATCH', `/api/investment-grants/${grant.id}`, { label: 'x', amountCents: 0, grantedOn: '2026-05-01', spreading: 'TENTHS' }, { id: grant.id })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error).toMatch(/doit être positif/)
    expect((await call('viewer', 'grant', 'DELETE', `/api/investment-grants/${grant.id}`, undefined, { id: grant.id })).status).toBe(403)
    expect((await call('accountant', 'grant', 'DELETE', `/api/investment-grants/${grant.id}`, undefined, { id: grant.id })).status).toBe(204)
  })

  it('lists doubtful receivables and moves one to 416 as a draft', async () => {
    await svc.createEntry({
      companyId: books.companyId,
      journalId: books.journals.VE,
      date: '2026-02-01',
      description: 'Facture F-010',
      status: 'validated',
      lines: [
        { accountId: books.accounts['411000'], debit: '600', credit: '0', auxiliaryAccountNumber: 'C00001' },
        { accountId: books.accounts['706000'], debit: '0', credit: '500' },
        { accountId: books.accounts['445710'], debit: '0', credit: '100' },
      ],
    })
    const list = await call('viewer', 'doubtful', 'GET', `/api/provisions/doubtful-receivables?companyId=${books.companyId}&fiscalYearId=${books.fiscalYearId}`)
    expect(list.status).toBe(200)
    expect((await list.json()).items).toEqual([expect.objectContaining({ tiersCode: 'C00001', overdueInclTaxCents: 60_000 })])
    const moved = await call('accountant', 'reclassify', 'POST', '/api/provisions/doubtful-receivables/reclassify', { companyId: books.companyId, fiscalYearId: books.fiscalYearId, tiersCode: 'C00001' })
    expect(moved.status).toBe(201)
    expect(await moved.json()).toMatchObject({ amountCents: 60_000 })
    expect((await call('viewer', 'reclassify', 'POST', '/api/provisions/doubtful-receivables/reclassify', { companyId: books.companyId, fiscalYearId: books.fiscalYearId, tiersCode: 'C00001' })).status).toBe(403)
  })

  it('reports the capital composition without personal data', async () => {
    await prisma.company.update({ where: { id: books.companyId }, data: { legalType: 'SAS', shareCapital: 10_000, totalShares: 1_000, shareNominalValue: 10 } })
    const person = await prisma.person.create({
      data: { companyId: books.companyId, firstName: 'Camille', name: 'Martin', email: 'camille@exemple.test', birthDate: new Date('1980-05-04T00:00:00Z'), birthCity: 'Lyon' },
    })
    await prisma.shareholder.create({ data: { companyId: books.companyId, type: 'PHYSICAL', personId: person.id, sharePercentage: 70, numberOfShares: 700 } })
    await prisma.shareholder.create({ data: { companyId: books.companyId, type: 'LEGAL', name: 'Holding Exemple', siret: '12345678900011', sharePercentage: 30, numberOfShares: 300 } })

    const response = await call('viewer', 'capital', 'GET', `/api/reports/capital-composition?companyId=${books.companyId}`)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toMatch(/1980|Lyon|camille@exemple/)
    const report = JSON.parse(text)
    expect(report.rows.map((r: { name: string; siren: string | null; sharesPercentHundredths: number; nominalAmountCents: number; declared: boolean }) => [r.name, r.siren, r.sharesPercentHundredths, r.nominalAmountCents, r.declared])).toEqual([
      ['Camille Martin', null, 7_000, 700_000, true],
      ['Holding Exemple', '123456789', 3_000, 300_000, true],
    ])
    expect(report.fiscalYear).toMatchObject({ year: 2026 })
    // Nothing booked in 101: the check names the difference with the capital
    expect(report.bookedCapitalCents).toBe(0)
    expect(report.checks).toEqual([expect.stringMatching(/^Le capital comptabilisé au compte 101 à la clôture de l'exercice 2026/)])
    expect((await call('outsider', 'capital', 'GET', `/api/reports/capital-composition?companyId=${books.companyId}`)).status).toBe(404)
    expect((await call('viewer', 'capital', 'GET', `/api/reports/capital-composition?companyId=${books.companyId}&fiscalYearId=${other.fiscalYearId}`)).status).toBe(404)
  })
})
