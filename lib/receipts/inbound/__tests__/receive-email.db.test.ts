/**
 * The receipt email address against PostgreSQL, through the webhook
 * (lib/receipts/inbound/handle-webhook.ts) as Postmark calls it:
 * - an email to a company's address stages its receipts, without uploader,
 *   read (a Factur-X invoice's data) and matched as a suggestion, never
 *   attached; a signature logo and a .docx are left out;
 * - the same email again stages nothing more; an email to no address, or
 *   to a former address, is accepted and dropped;
 * - a request without the right password is refused, the feature off is a 404;
 * - the address is created and changed by an administrator, the former one
 *   then receives nothing.
 * Skipped when the test database server is unreachable.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('receipt_email')
  process.env.RATE_LIMIT_DISABLED = 'true'
})

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { ciiXml, facturXPdf, sampleInvoice } from '@/lib/invoices/e-invoice/__tests__/fixtures'

const available = await testDatabaseAvailable()

type Prisma = typeof import('@/lib/prisma').prisma
let prisma: Prisma
let route: typeof import('@/app/api/inbound-email/[provider]/route')
let receive: typeof import('../receive-email.service')
let inbox: typeof import('../inbox.service')
/** The webhook route as Next calls it. */
const handle = (provider: string, request: Request) => route.POST(request, { params: Promise.resolve({ provider }) })

const DOMAIN = 'justificatifs.example.fr'
const PASSWORD = 'a-long-postmark-password'
const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const auth = (password = PASSWORD) => `Basic ${Buffer.from(`kledg:${password}`).toString('base64')}`

async function seed() {
  await prisma.user.create({ data: { id: 'u-admin', email: 'admin@test.local', name: 'Admin' } })
  const company = await prisma.company.create({ data: { name: 'Atelier Martin', slug: 'atelier-martin', siren: '930000120' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL', login: 'martin' } })
  const account = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'acc-1', name: 'Compte courant' } })
  // 292,75 TTC: the sample Factur-X invoice, paid three days after its date
  const tx = await prisma.bankTransaction.create({ data: { bankAccountId: account.id, externalTransactionId: 'papeterie', amount: 292.75, date: day('2026-03-05'), side: 'debit', label: 'PRLV PAPETERIE DURAND' } })
  await prisma.fiscalYear.create({ data: { companyId: company.id, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') } })
  Object.assign(ids, { company: company.id, transaction: tx.id })
}

function postmark(to: string, attachments: Array<Record<string, unknown>>, password = PASSWORD) {
  return new Request('https://kledg.test/api/inbound-email/postmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth(password) },
    body: JSON.stringify({ MessageID: 'pm-1', FromFull: { Email: 'factures@papeterie-durand.fr' }, ToFull: [{ Email: to }], Subject: 'Facture F2026-0042', Attachments: attachments }),
  })
}

const invoicePdf = () => ({ Name: 'F2026-0042.pdf', Content: Buffer.from(facturXPdf(ciiXml(sampleInvoice()))).toString('base64'), ContentType: 'application/pdf' })
const logo = { Name: 'logo.png', Content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'), ContentType: 'image/png', ContentID: 'logo@durand' }
const docx = { Name: 'conditions.docx', Content: Buffer.from('PK\u0003\u0004 word').toString('base64'), ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }

describe.skipIf(!available)('receipt email address', () => {
  beforeAll(async () => {
    await prepareTestDatabase('receipt_email')
    ;({ prisma } = await import('@/lib/prisma'))
    route = await import('@/app/api/inbound-email/[provider]/route')
    receive = await import('../receive-email.service')
    inbox = await import('../inbox.service')
  }, 60_000)

  beforeEach(async () => {
    process.env.KLEDG_RECEIPTS_EMAIL_DOMAIN = DOMAIN
    process.env.POSTMARK_INBOUND_PASSWORD = PASSWORD
    await prepareTestDatabase('receipt_email')
    await seed()
  })

  afterEach(() => {
    delete process.env.KLEDG_RECEIPTS_EMAIL_DOMAIN
    delete process.env.POSTMARK_INBOUND_PASSWORD
  })

  it('stages the receipts of an email, read and suggested, never attached; a logo and a .docx left out', async () => {
    const { address } = await inbox.renewReceiptInbox(ids.company, 'u-admin')
    expect(address).toMatch(new RegExp(`^[a-z0-9]{16}@${DOMAIN.replace(/\./g, '\\.')}$`))

    const response = await handle('postmark', postmark(address as string, [invoicePdf(), logo, docx]))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ staged: 1, duplicates: 0, skipped: 2 })

    const [receipt] = await prisma.stagedReceipt.findMany({ where: { companyId: ids.company } })
    expect(receipt).toMatchObject({ source: 'email', status: 'staged', uploadedById: null, fieldsReadFrom: 'e-invoice', merchantName: 'Papeterie Durand SARL', suggestedTransactionId: ids.transaction, attachmentId: null })
    expect(Number(receipt.amount)).toBe(292.75)
    expect(await prisma.attachment.count()).toBe(0)

    // The same email again: nothing more
    expect(await (await handle('postmark', postmark(address as string, [invoicePdf()]))).json()).toEqual({ staged: 0, duplicates: 1, skipped: 0 })
    expect(await prisma.stagedReceipt.count()).toBe(1)
  })

  it('accepts and drops an email to no address of a company, and to a former address', async () => {
    const first = (await inbox.renewReceiptInbox(ids.company, 'u-admin')).address as string
    const second = (await inbox.renewReceiptInbox(ids.company, 'u-admin')).address as string
    expect(second).not.toBe(first)
    for (const to of [first, `inconnu@${DOMAIN}`, 'compta@ailleurs.fr']) {
      const response = await handle('postmark', postmark(to, [invoicePdf()]))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ignored: true })
    }
    expect(await prisma.stagedReceipt.count()).toBe(0)
  })

  it('takes at most 10 attachments of an email, and leaves an email with none as received', async () => {
    const { address } = await inbox.renewReceiptInbox(ids.company, 'u-admin')
    const many = Array.from({ length: 12 }, (_, n) => ({
      fileName: `ticket-${n}.pdf`,
      contentType: 'application/pdf',
      inline: false,
      size: 20,
      load: async () => new Uint8Array(Buffer.from(`%PDF-1.4 ticket ${n}`)),
    }))
    const email = { messageId: 'm-1', from: 'a@b.fr', recipients: [address as string], subject: null, attachments: many }
    expect(await receive.receiveInboundEmail(email, 'postmark')).toMatchObject({ outcome: 'received', staged: 10, skipped: 2 })
    expect(await receive.receiveInboundEmail({ ...email, attachments: [] }, 'postmark')).toMatchObject({ outcome: 'received', staged: 0 })
    expect(await receive.receiveInboundEmail({ ...email, recipients: ['x@y.fr'] }, 'postmark')).toEqual({ outcome: 'no-company' })
  })

  it('refuses a wrong password, and answers 404 for a provider not configured or the feature off', async () => {
    const { address } = await inbox.renewReceiptInbox(ids.company, 'u-admin')
    expect((await handle('postmark', postmark(address as string, [invoicePdf()], 'guess'))).status).toBe(401)
    expect((await handle('mailgun', new Request('https://kledg.test/api/inbound-email/mailgun', { method: 'POST', body: new FormData() }))).status).toBe(404)
    expect((await handle('sendgrid', postmark(address as string, []))).status).toBe(404)
    delete process.env.KLEDG_RECEIPTS_EMAIL_DOMAIN
    expect((await handle('postmark', postmark(address as string, [invoicePdf()]))).status).toBe(404)
    expect(await inbox.receiptInboxOf(ids.company)).toEqual({ available: false, address: null, changedAt: null })
    expect(await prisma.stagedReceipt.count()).toBe(0)
  })
})
