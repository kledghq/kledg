/**
 * Routes of the "Déposer des justificatifs" drop zone of the Justificatifs
 * page (app/api/receipts/staged/**, docs/justificatifs-photo.md), against
 * PostgreSQL with the session mocked:
 * - POST /api/receipts/staged: a real multipart upload, type read from the
 *   bytes, the fields its name gives, the same file twice staged once;
 * - GET: the user's own receipts waiting to be filed;
 * - POST .../match, .../attach, .../expense and DELETE: the fields the user
 *   confirmed, the transaction found, the receipt kept by Kledg for a bank
 *   without receipt API, an expense report brouillon, a discard;
 * - French 400s, roles (403) and other companies (404).
 * Skipped when the test database server is unreachable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_routes')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
let prisma: typeof import('@/lib/prisma').prisma
const routes = {} as Record<'staged' | 'one' | 'match' | 'attach' | 'expense', Record<string, Handler>>

const USERS = {
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Comptable', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Lecteur', role: 'user' },
  memberB: { id: 'u-b', email: 'b@test.local', name: 'B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'
const ids = {} as Record<string, string>
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 7])

function as(who: Who) {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
}

async function upload(who: Who, companyId: string, file: File | null) {
  as(who)
  const form = new FormData()
  form.set('companyId', companyId)
  if (file) form.set('file', file)
  return routes.staged.POST(new NextRequest('http://localhost/api/receipts/staged', { method: 'POST', body: form }))
}

async function json(who: Who, route: 'match' | 'attach' | 'expense' | 'one', method: 'POST' | 'DELETE', id: string, body?: unknown) {
  as(who)
  const suffix = route === 'one' ? '' : `/${route}`
  const request = new NextRequest(`http://localhost/api/receipts/staged/${id}${suffix}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve({ id }) })
}

describe.skipIf(!available)('receipt drop zone routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipt_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    routes.staged = (await import('@/app/api/receipts/staged/route')) as unknown as Record<string, Handler>
    routes.one = (await import('@/app/api/receipts/staged/[id]/route')) as unknown as Record<string, Handler>
    routes.match = (await import('@/app/api/receipts/staged/[id]/match/route')) as unknown as Record<string, Handler>
    routes.attach = (await import('@/app/api/receipts/staged/[id]/attach/route')) as unknown as Record<string, Handler>
    routes.expense = (await import('@/app/api/receipts/staged/[id]/expense/route')) as unknown as Record<string, Handler>
    for (const user of Object.values(USERS)) await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role } })
    for (const [prefix, members] of [
      ['a', [['u-accountant', 'accountant'], ['u-viewer', 'viewer']]],
      ['b', [['u-b', 'companyAdmin']]],
    ] as const) {
      const company = await prisma.company.create({ data: { name: `Société ${prefix}`, slug: `societe-${prefix}`, siren: prefix === 'a' ? '111111111' : '222222222' } })
      await prisma.organization.create({ data: { id: `org-${prefix}`, name: company.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: company.id } })
      for (const [userId, role] of members) await prisma.member.create({ data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role, createdAt: new Date() } })
      const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
      const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${prefix}`, name: 'Compte pro' } })
      const tx = await prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId: `${prefix}-1`, amount: 23.45, date: new Date('2026-10-04T00:00:00Z'), side: 'debit', label: 'CB CARREFOUR CITY' } })
      await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') } })
      ids[`${prefix}Company`] = company.id
      ids[`${prefix}Tx`] = tx.id
    }
  }, 60_000)

  it('stages an upload from its bytes, guesses the fields from its name, and stages the same file once', async () => {
    const file = new File([JPEG], '2026-10-03 Carrefour 23,45.jpg', { type: 'application/octet-stream' })
    const response = await upload('accountant', ids.aCompany, file)
    expect(response.status).toBe(201)
    const body = (await response.json()) as { receipt: { id: string; contentType: string; source: string }; guess: unknown; duplicate: boolean }
    expect(body).toMatchObject({ duplicate: false, receipt: { contentType: 'image/jpeg', source: 'app' }, guess: { date: '2026-10-03', amountCents: 2_345, merchant: 'Carrefour' } })
    ids.receipt = body.receipt.id
    const again = await upload('accountant', ids.aCompany, new File([JPEG], 'copie.jpg', { type: 'image/jpeg' }))
    expect(again.status).toBe(200)
    expect(((await again.json()) as { duplicate: boolean; receipt: { id: string } }).receipt.id).toBe(ids.receipt)

    as('accountant')
    const listed = (await (await routes.staged.GET(new NextRequest(`http://localhost/api/receipts/staged?companyId=${ids.aCompany}`))).json()) as { receipts: Array<{ id: string }> }
    expect(listed.receipts.map((r) => r.id)).toEqual([ids.receipt])
  })

  it('answers French 400s for a missing file or a file that is not a receipt', async () => {
    expect(await (await upload('viewer', ids.aCompany, null)).json()).toEqual({ error: 'Joignez un fichier (photo JPEG ou PNG, ou PDF).' })
    const html = await upload('viewer', ids.aCompany, new File(['<html>'], 'facture.pdf', { type: 'application/pdf' }))
    expect(html.status).toBe(400)
    expect(((await html.json()) as { error: string }).error).toBe('Type de fichier non accepté : une photo JPEG ou PNG, ou un PDF.')
    const fields = await json('accountant', 'match', 'POST', ids.receipt, { fields: { amountCents: -5, date: 'hier' } })
    expect(fields.status).toBe(400)
  })

  it('matches with the confirmed fields and keeps the receipt in Kledg for a bank without receipt API', async () => {
    const matched = await json('accountant', 'match', 'POST', ids.receipt, { fields: { amountCents: 2_345, date: '2026-10-03', merchant: 'Carrefour' } })
    expect(matched.status).toBe(200)
    expect(await matched.json()).toMatchObject({ outcome: 'matched', match: { transactionId: ids.aTx, sendsToBank: false } })
    const attached = await json('accountant', 'attach', 'POST', ids.receipt, { transactionId: ids.aTx })
    expect(attached.status).toBe(200)
    expect(await attached.json()).toMatchObject({ destination: 'kledg', receipts: 1, alreadyAttached: false })
    // Another company's transaction is not found, and the receipt is filed
    expect((await json('accountant', 'attach', 'POST', ids.receipt, { transactionId: ids.bTx })).status).toBe(404)
    expect((await json('accountant', 'one', 'DELETE', ids.receipt)).status).toBe(409)
  })

  it('lets a viewer prepare an expense report from their receipt, never attach it', async () => {
    const response = await upload('viewer', ids.aCompany, new File([new Uint8Array([...JPEG, 1])], 'resto.jpg', { type: 'image/jpeg' }))
    const id = ((await response.json()) as { receipt: { id: string } }).receipt.id
    expect((await json('viewer', 'match', 'POST', id, { fields: { amountCents: 3_100, date: '2026-10-06', merchant: 'Le Zinc', paymentHint: 'personal_card' } })).status).toBe(200)
    expect((await json('viewer', 'attach', 'POST', id, { transactionId: ids.aTx })).status).toBe(403)
    const expense = await json('viewer', 'expense', 'POST', id, {})
    expect(expense.status).toBe(201)
    const body = (await expense.json()) as { reportId: string; created: boolean; totalOwedCents: number }
    expect(body).toMatchObject({ created: true, totalOwedCents: 3_100 })
    expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: body.reportId } })).status).toBe('DRAFT')
    // Its receipt is not reachable by a member of another company, nor anonymously
    expect((await json('memberB', 'match', 'POST', id, {})).status).toBe(404)
    expect((await json('anonymous', 'match', 'POST', id, {})).status).toBe(401)
  })

  it('discards a receipt staged by mistake', async () => {
    const response = await upload('viewer', ids.aCompany, new File([new Uint8Array([...JPEG, 2])], 'erreur.jpg', { type: 'image/jpeg' }))
    const id = ((await response.json()) as { receipt: { id: string } }).receipt.id
    const discarded = await json('viewer', 'one', 'DELETE', id)
    expect(discarded.status).toBe(200)
    expect(await discarded.json()).toMatchObject({ receipt: { status: 'discarded', hasFile: false } })
  })
})
