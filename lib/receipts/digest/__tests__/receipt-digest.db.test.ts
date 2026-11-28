/**
 * The weekly email of missing receipts (lib/receipts/digest) against
 * PostgreSQL, with the email sending mocked:
 * - Mondays in France only;
 * - to the members who can attach receipts (an accountant, not a viewer),
 *   one email for all their companies, the debits of the last 30 days
 *   without a receipt, the company name escaped;
 * - nothing for a company where nothing is missing, nor for a user who
 *   turned it off; one a week at most;
 * - the user's own setting through /api/account/notifications.
 * Skipped when the test database server is unreachable.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_digest')
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
})

const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; html: string; text: string }>, session: { user: null as null | { id: string; email: string; role: string | null } } }))

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/email', () => ({
  isEmailEnabled: async () => true,
  sendEmail: async (message: { to: string; subject: string; html: string; text: string }) => {
    mail.sent.push(message)
  },
}))
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => mail.session.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { GET as getNotifications, PUT as putNotifications } from '@/app/api/account/notifications/route'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let service: typeof import('../receipt-digest.service')

// Monday 30 November 2026, 06:00 in Paris
const MONDAY = new Date('2026-11-30T05:00:00Z')
const daysAgo = (n: number) => new Date(Date.UTC(2026, 10, 30 - n))

async function seed() {
  const company = await prisma.company.create({ data: { name: 'Atelier <Martin>', slug: 'atelier-martin', siren: '930000201' } })
  const quiet = await prisma.company.create({ data: { name: 'Studio Nord', slug: 'studio-nord', siren: '930000202' } })
  for (const [id, email] of [
    ['u-accountant', 'compta@atelier.fr'],
    ['u-viewer', 'lecture@atelier.fr'],
    ['u-quiet', 'nord@studio.fr'],
    ['u-off', 'off@atelier.fr'],
  ]) {
    await prisma.user.create({ data: { id, email, name: id } })
  }
  const org = async (c: { id: string; name: string }, prefix: string, members: Array<[string, string]>) => {
    await prisma.organization.create({ data: { id: `org-${prefix}`, name: c.name, slug: `org-${prefix}`, createdAt: new Date(), companyId: c.id } })
    for (const [userId, role] of members) await prisma.member.create({ data: { id: `m-${prefix}-${userId}`, userId, organizationId: `org-${prefix}`, role, createdAt: new Date() } })
  }
  await org(company, 'a', [
    ['u-accountant', 'accountant'],
    ['u-viewer', 'viewer'],
    ['u-off', 'companyAdmin'],
  ])
  await org(quiet, 'b', [
    ['u-accountant', 'accountant'],
    ['u-quiet', 'companyAdmin'],
  ])
  await prisma.userPreference.create({ data: { userId: 'u-off', receiptDigest: false } })

  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, login: 'atelier', secretKeyEncrypted: 'x' } })
  const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'courant', name: 'Courant' } })
  let n = 0
  const tx = (date: Date, amount: number, side: 'debit' | 'credit', label: string) =>
    prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId: `t${++n}`, amount, date, side, label } })
  await tx(daysAgo(2), 42.5, 'debit', 'CB <PAPETERIE>')
  await tx(daysAgo(10), 120, 'debit', 'PRLV OVH SAS')
  await tx(daysAgo(45), 300, 'debit', 'Trop ancien')
  await tx(daysAgo(3), 900, 'credit', 'Virement client')
  const filed = await tx(daysAgo(4), 15, 'debit', 'Avec justificatif')
  await prisma.attachment.create({ data: { companyId: company.id, bankTransactionId: filed.id, fileName: 'facture.pdf' } })
}

describe.skipIf(!available)('weekly email of missing receipts', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipt_digest')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('../receipt-digest.service')
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('receipt_digest')
    mail.sent.length = 0
    await seed()
  })

  it('goes on Mondays in France', () => {
    expect(service.isDigestDay(MONDAY)).toBe(true)
    // Sunday 23:30 UTC is already Monday in Paris; Monday 23:30 UTC is Tuesday
    expect(service.isDigestDay(new Date('2026-11-29T23:30:00Z'))).toBe(true)
    expect(service.isDigestDay(new Date('2026-11-30T23:30:00Z'))).toBe(false)
  })

  it('sends one email to each member who can attach receipts, with the debits of 30 days still missing', async () => {
    expect(await service.sendReceiptDigests(MONDAY)).toEqual({ sent: 1, skipped: 1, failed: 0 })
    // The viewer cannot attach, the user who turned it off gets nothing, Studio Nord misses nothing
    expect(mail.sent.map((m) => m.to)).toEqual(['compta@atelier.fr'])
    const [email] = mail.sent
    expect(email.subject).toBe('2 justificatifs manquants dans Kledg')
    expect(email.html).toContain('Atelier &lt;Martin&gt;')
    expect(email.html).toContain('CB &lt;PAPETERIE&gt;')
    expect(email.html).not.toContain('<PAPETERIE>')
    expect(email.html).not.toMatch(/Trop ancien|Virement client|Avec justificatif|Studio Nord/)
    expect(email.html).toContain('/atelier-martin/banking/missing-receipts')
    expect(email.text).toContain('/settings/profile')

    // Once a week: the same day again, or the keyless cron called twice, sends nothing more
    expect(await service.sendReceiptDigests(new Date(MONDAY.getTime() + 3_600_000))).toMatchObject({ sent: 0 })
    expect(mail.sent).toHaveLength(1)
    // The next Monday it goes again
    expect(await service.sendReceiptDigests(new Date(MONDAY.getTime() + 7 * 86_400_000))).toMatchObject({ sent: 1 })
  })

  it('is turned off and on by the user, for themself only', async () => {
    mail.session.user = { id: 'u-accountant', email: 'compta@atelier.fr', role: null }
    const put = (body: unknown) =>
      putNotifications(new Request('http://localhost:3000/api/account/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify(body) }) as never, { params: Promise.resolve({}) } as never)
    expect(await (await getNotifications(new Request('http://localhost:3000/api/account/notifications') as never, { params: Promise.resolve({}) } as never)).json()).toEqual({ receiptDigest: true })
    expect((await put({ receiptDigest: false })).status).toBe(200)
    expect((await put({ receiptDigest: true, userId: 'u-viewer' })).status).toBe(400)

    expect(await service.sendReceiptDigests(MONDAY)).toMatchObject({ sent: 0 })
    expect(await prisma.userPreference.findUnique({ where: { userId: 'u-accountant' }, select: { receiptDigest: true } })).toEqual({ receiptDigest: false })
  })
})
