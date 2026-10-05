/**
 * "Recettes à vérifier" of simple mode against PostgreSQL
 * (docs/categories-simples.md#recettes-à-vérifier), through the real routes
 * with only the session mocked, on the PCG chart Kledg seeds:
 * - a credit that pays an open sales invoice is proposed as its payment;
 *   confirming books the bank line and the customer line (411 of the
 *   invoice, customer auxiliary account), and the invoices module records
 *   the payment and letters the invoice (no new accounting rule), a part
 *   payment without lettering, the VAT on receipts moved 44574 to 44571;
 * - with accountant review the entry stays a draft, the payment is pending
 *   (the invoice is not proposed twice) and is recorded when the
 *   accountant validates the entry;
 * - categories of money in: a sale with its collected VAT at the rate
 *   answered, money from a partner after its question (455), the refund of
 *   an expense (charge and VAT reversed), a VAT refund on 44567 only;
 * - another company's invoice or transaction is a 404, a read-only member
 *   gets a 403, an amount above what is left to pay a 400, an expense
 *   category for money in a 400;
 * - "Tout confirmer" confirms the sure invoice payments;
 * - undoing the reconciliation of a draft payment reopens the invoice.
 * Run with KLEDG_RLS=enforce too (docs/rls.md).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('simple_income')
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let receipts: typeof import('@/lib/simple/invoice-receipts.service')
let confirmService: typeof import('@/lib/simple/confirm-expense.service')
let validation: typeof import('@/lib/simple/simple-validation.service')
let lifecycle: typeof import('@/lib/accounting/services/entry-lifecycle.service')
let invoicesSvc: typeof import('@/lib/invoices/manage-invoices.service')
let postingSvc: typeof import('@/lib/invoices/post-invoice.service')
let tiersSvc: typeof import('@/lib/tiers/manage-tiers.service')
const routes = {} as Record<string, Module>

const N = ' '

const USERS = {
  owner: { id: 'u-owner', email: 'claire@test.local', name: 'Claire Petit', role: 'user' },
  accountant: { id: 'u-acc', email: 'marc@test.local', name: 'Marc Renaud', role: 'user' },
  viewer: { id: 'u-view', email: 'view@test.local', name: 'Lecture', role: 'user' },
  outsider: { id: 'u-out', email: 'out@test.local', name: 'Autre société', role: 'user' },
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
  customerId: string
}

let seq = 0

async function seedCompany(slug: string, siren: string): Promise<Company> {
  const { seedPCG } = await import('@/prisma/seeds/pcg')
  const company = await prisma.company.create({ data: { name: slug, slug, siren } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  await seedPCG(company.id, fy.id, false)
  for (const [code, label] of [
    ['BQ', 'Banque'],
    ['VE', 'Ventes'],
    ['OD', 'Opérations diverses'],
  ]) {
    await prisma.journal.create({ data: { companyId: company.id, code, label } })
  }
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${slug}`, name: 'Compte courant' } })
  const customer = await tiersSvc.createTiers(company.id, { kind: 'CUSTOMER', name: 'SAS Studio Nord', email: null, siren: '732829320' })
  return { id: company.id, fiscalYearId: fy.id, bankAccountId: bankAccount.id, customerId: customer.id }
}

/** A posted sales invoice of goods (VAT due on delivery, 44571), its entry validated unless asked otherwise. */
async function salesInvoice(company: Company, number: string, unitPriceCents: number, options: { nature?: 'GOODS' | 'SERVICES'; validate?: boolean } = {}) {
  const invoice = await invoicesSvc.createInvoice(company.id, {
    direction: 'SALE',
    tiersId: company.customerId,
    number,
    // Numbers chosen by the test: an invoice already issued, outside Kledg's series
    numbering: 'recorded',
    issueDate: '2026-09-01',
    typeCode: '380',
    lines: [{ label: 'Prestation', quantity: '1', unitPriceCents, vatRateBp: 2000, accountCode: null, nature: options.nature ?? 'GOODS', fixedAsset: false }],
  })
  const posted = await postingSvc.postInvoice(company.id, invoice.id)
  if (options.validate !== false) await lifecycle.validateEntries(company.id, [posted.entryId])
  return { id: invoice.id, entryId: posted.entryId }
}

async function transaction(company: Company, label: string, amount: number, options: { day?: string; side?: 'debit' | 'credit'; counterpartyName?: string } = {}) {
  seq += 1
  return prisma.bankTransaction.create({
    data: {
      bankAccountId: company.bankAccountId,
      externalTransactionId: `income-${seq}`,
      amount,
      date: new Date(`${options.day ?? '2026-09-20'}T00:00:00Z`),
      side: options.side ?? 'credit',
      label,
      counterpartyName: options.counterpartyName ?? null,
    },
  })
}

async function entryOf(entryId: string) {
  return prisma.accountingEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: { lines: { include: { account: { select: { code: true } } } }, simpleModeEntry: true },
  })
}

const cents = (value: { toString(): string }) => Math.round(Number(value.toString()) * 100)
const linesOf = (entry: Awaited<ReturnType<typeof entryOf>>) =>
  entry.lines.map((l) => [l.account.code, cents(l.debit), cents(l.credit), l.auxiliaryAccountNumber]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))

/** Payments recorded on the invoice and the lettering of its customer line. */
async function settlement(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { payments: { select: { amount: true, vatTransferEntryId: true } }, entry: { select: { lines: { where: { account: { code: { startsWith: '411' } } }, select: { letteringCode: true } } } } },
  })
  return {
    paidCents: invoice.payments.reduce((sum, p) => sum + cents(p.amount), 0),
    lettered: Boolean(invoice.entry?.lines[0]?.letteringCode),
    vatTransferEntryIds: invoice.payments.map((p) => p.vatTransferEntryId).filter(Boolean),
  }
}

describe.skipIf(!available)('simple mode, money in (PostgreSQL)', () => {
  let a: Company
  let b: Company

  beforeAll(async () => {
    await prepareTestDatabase('simple_income')
    ;({ prisma } = await import('@/lib/prisma'))
    receipts = await import('@/lib/simple/invoice-receipts.service')
    confirmService = await import('@/lib/simple/confirm-expense.service')
    validation = await import('@/lib/simple/simple-validation.service')
    lifecycle = await import('@/lib/accounting/services/entry-lifecycle.service')
    invoicesSvc = await import('@/lib/invoices/manage-invoices.service')
    postingSvc = await import('@/lib/invoices/post-invoice.service')
    tiersSvc = await import('@/lib/tiers/manage-tiers.service')
    Object.assign(routes, {
      list: await import('@/app/api/simple/expenses/route'),
      confirm: await import('@/app/api/simple/expenses/[id]/confirm/route'),
      confirmAll: await import('@/app/api/simple/expenses/confirm-all/route'),
      counts: await import('@/app/api/companies/[id]/simple/counts/route'),
      bulkValidate: await import('@/app/api/entries/bulk-validate/route'),
      reconcile: await import('@/app/api/transactions/[id]/reconcile/route'),
    })
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('simple_income')
    a = await seedCompany('atelier-lumen', '940000501')
    b = await seedCompany('autre-societe', '940000502')
    await seedMembership(prisma, USERS.owner.id, a.id, 'companyAdmin')
    await seedMembership(prisma, USERS.viewer.id, a.id, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, b.id, 'companyAdmin')
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  async function addAccountant() {
    await seedMembership(prisma, USERS.accountant.id, a.id, 'accountant')
    await prisma.user.update({ where: { id: USERS.accountant.id }, data: { name: USERS.accountant.name } })
  }

  const confirm = (as: Who, id: string, body: unknown = {}) => call(as, 'confirm', 'POST', `/api/simple/expenses/${id}/confirm`, { body, params: { id } })
  const list = async (as: Who = 'owner') => (await call(as, 'list', 'GET', `/api/simple/expenses?companyId=atelier-lumen&side=credit`)).json()

  it('lists the money in with the invoice it pays, for a read-only member too, and counts it for the navigation', async () => {
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000)
    const paid = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200, { day: '2026-09-25' })
    const grant = await transaction(a, 'VIR SEPA BPIFRANCE SUBVENTION INNOVATION', 30000, { day: '2026-09-10' })
    await transaction(a, 'PRLV SEPA FREE PRO', 47.99, { side: 'debit' })
    await transaction(b, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)

    const response = await call('viewer', 'list', 'GET', `/api/simple/expenses?companyId=atelier-lumen&side=credit`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.count).toBe(2)
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([paid.id, grant.id])
    expect(body.items[0]).toMatchObject({
      side: 'credit',
      amountCents: 120_000,
      suggestion: {
        source: 'invoice',
        confidence: 'high',
        categoryId: null,
        bulkConfirmable: true,
        invoice: { invoiceId: invoice.id, number: 'F-2026-012', customerName: 'SAS Studio Nord', remainingCents: 120_000, partial: false },
        reason: `Règle la facture n°${N}F-2026-012 de SAS Studio Nord`,
      },
    })
    expect(body.items[1].suggestion).toMatchObject({ categoryId: 'subvention', confidence: 'high', source: 'payee', invoice: null })
    expect(body.bulkConfirmableIds).toEqual([paid.id, grant.id])

    const counts = await call('viewer', 'counts', 'GET', `/api/companies/${a.id}/simple/counts`, { params: { id: a.id } })
    expect(await counts.json()).toEqual({ expensesToCheck: 1, incomeToCheck: 2 })
    expect((await call('outsider', 'list', 'GET', `/api/simple/expenses?companyId=atelier-lumen&side=credit`)).status).toBe(404)
  })

  it('records the payment on the invoice and letters it, without an accountant: bank and customer lines, no new rule', async () => {
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000)
    const paid = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    const response = await confirm('owner', paid.id)
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result).toMatchObject({
      status: 'validated',
      needsReview: false,
      categoryId: null,
      learnedRule: null,
      invoice: { id: invoice.id, number: 'F-2026-012', customerName: 'SAS Studio Nord', recorded: true, lettered: true, remainingCents: 0, pending: null },
    })
    const entry = await entryOf(result.entryId)
    expect(entry.status).toBe('validated')
    expect(linesOf(entry)).toEqual([
      ['411', 0, 120_000, 'C00001'],
      ['5121', 120_000, 0, null],
    ])
    expect(entry.simpleModeEntry).toMatchObject({ invoiceId: invoice.id, categoryId: null, needsReview: false })
    expect(await settlement(invoice.id)).toEqual({ paidCents: 120_000, lettered: true, vatTransferEntryIds: [] })
    expect(await prisma.transactionRule.count()).toBe(0)

    // Paid: never proposed again
    const again = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200, { day: '2026-09-28' })
    expect((await list()).items.find((i: { id: string }) => i.id === again.id).suggestion.invoice).toBeNull()
    const refused = await confirm('owner', again.id, { invoiceId: invoice.id })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe('La facture n° F-2026-012 est déjà payée.')
  })

  it('records a part payment without lettering, then letters the invoice with the payment that completes it', async () => {
    const invoice = await salesInvoice(a, 'F-2026-020', 300_000)
    const first = await transaction(a, 'VIR STUDIO NORD ACOMPTE F-2026-020', 1000, { day: '2026-09-10' })
    const listed = (await list()).items[0]
    expect(listed.suggestion).toMatchObject({ confidence: 'medium', invoice: { invoiceId: invoice.id, partial: true }, bulkConfirmable: false })
    const part = await (await confirm('owner', first.id)).json()
    expect(part.invoice).toMatchObject({ recorded: true, lettered: false, remainingCents: 260_000 })
    expect(await settlement(invoice.id)).toMatchObject({ paidCents: 100_000, lettered: false })

    const rest = await transaction(a, 'VIR STUDIO NORD SOLDE F-2026-020', 2600, { day: '2026-09-30' })
    const done = await (await confirm('owner', rest.id, { invoiceId: invoice.id })).json()
    expect(done.invoice).toMatchObject({ recorded: true, lettered: true, remainingCents: 0 })
    expect(await settlement(invoice.id)).toMatchObject({ paidCents: 360_000, lettered: true })
  })

  it('moves the VAT on receipts of a services invoice from 44574 to 44571 with the payment (CGI art. 269, 2, c)', async () => {
    await prisma.account.create({ data: { companyId: a.id, fiscalYearId: a.fiscalYearId, code: '44574', label: 'TVA collectée en attente d’encaissement' } })
    const invoice = await salesInvoice(a, 'F-2026-030', 50_000, { nature: 'SERVICES' })
    const paid = await transaction(a, 'VIR SEPA STUDIO NORD F-2026-030', 600)
    expect((await (await confirm('owner', paid.id)).json()).invoice).toMatchObject({ recorded: true, lettered: true })
    const { vatTransferEntryIds } = await settlement(invoice.id)
    expect(vatTransferEntryIds).toHaveLength(1)
    const transfer = await entryOf(vatTransferEntryIds[0]!)
    expect(linesOf(transfer)).toEqual([
      ['44571', 0, 10_000, null],
      ['44574', 10_000, 0, null],
    ])
    expect(transfer.date.toISOString().slice(0, 10)).toBe('2026-09-20')
  })

  it('with an accountant, leaves the payment a draft, pending on the invoice, recorded when the accountant validates it', async () => {
    await addAccountant()
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000)
    const paid = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    const result = await (await confirm('owner', paid.id)).json()
    expect(result).toMatchObject({ status: 'draft', needsReview: true, invoice: { recorded: false, lettered: false, pending: 'Le paiement sera enregistré sur la facture quand votre comptable aura validé l’écriture.' } })
    expect(await settlement(invoice.id)).toMatchObject({ paidCents: 0, lettered: false })

    // The amount waits: the invoice is not proposed for a second identical credit
    expect(await receipts.loadOpenSalesInvoices(a.id)).toEqual([])
    const twice = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200, { day: '2026-09-21' })
    const refused = await confirm('owner', twice.id, { invoiceId: invoice.id })
    expect(refused.status).toBe(409)

    const view = await validation.listSimpleModeEntries(a.id, { status: 'to-validate', limit: 50 })
    expect(view.items).toEqual([expect.objectContaining({ entryId: result.entryId, categoryLabel: 'Paiement de la facture n° F-2026-012', invoice: { id: invoice.id, number: 'F-2026-012', customerName: 'SAS Studio Nord', recorded: false } })])

    const validated = await call('accountant', 'bulkValidate', 'POST', '/api/entries/bulk-validate', { body: { companyId: a.id, entryIds: [result.entryId], status: 'validated' } })
    expect(validated.status).toBe(200)
    expect(await settlement(invoice.id)).toMatchObject({ paidCents: 120_000, lettered: true })
    const after = await validation.listSimpleModeEntries(a.id, { status: 'validated', limit: 50 })
    expect(after.items[0].invoice).toMatchObject({ recorded: true })
    // Validating again records nothing twice
    expect(await receipts.recordValidatedInvoicePayments(a.id)).toEqual([])
  })

  it('leaves an assistant payment a draft (MCP), recorded once validated through the entry life cycle', async () => {
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000)
    const paid = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    const result = await confirmService.confirmExpense(a.id, paid.id, { invoiceId: invoice.id, learn: false }, { userId: USERS.owner.id, canValidate: true, source: 'mcp' })
    expect(result).toMatchObject({ status: 'draft', invoice: { recorded: false } })
    await lifecycle.updateDraftEntry(result.entryId, { status: 'validated' }, a.id)
    expect(await settlement(invoice.id)).toMatchObject({ paidCents: 120_000, lettered: true })
  })

  it('books categories of money in: a sale with collected VAT at the rate answered, a partner loan, a refund, a VAT refund', async () => {
    // A known customer without an invoice: a sale at 10 %
    const sale = await transaction(a, 'VIR SEPA STUDIO NORD', 1100)
    expect((await list()).items[0].suggestion).toMatchObject({ categoryId: 'ventes-prestations', source: 'customer', answers: { 'sale-vat-rate': 'standard' } })
    const booked = await (await confirm('owner', sale.id, { categoryId: 'ventes-prestations', answers: { 'sale-vat-rate': 'intermediate' } })).json()
    expect(linesOf(await entryOf(booked.entryId))).toEqual([
      ['44571', 0, 10_000, null],
      ['5121', 110_000, 0, null],
      ['706', 0, 100_000, null],
    ])

    // Money from a partner: the question first, then the current account
    const person = await prisma.person.create({ data: { firstName: 'Jean', name: 'Dupont', companyId: a.id } })
    await prisma.shareholder.create({ data: { companyId: a.id, type: 'PHYSICAL', personId: person.id, sharePercentage: '100' } })
    const loan = await transaction(a, 'VIR INSTANTANE M JEAN DUPONT', 5000)
    const item = (await list()).items.find((i: { id: string }) => i.id === loan.id)
    expect(item.suggestion).toMatchObject({ categoryId: 'versement-associe', source: 'owner', bulkConfirmable: false, pendingQuestion: { id: 'owner-money' } })
    const unanswered = await confirm('owner', loan.id)
    expect(unanswered.status).toBe(400)
    expect((await unanswered.json()).error).toBe(`Répondez d'abord à la question${N}: Est-ce de l’argent que vous avez prêté à votre société${N}?`)
    const lent = await (await confirm('owner', loan.id, { answers: { 'owner-money': 'loan' } })).json()
    expect(linesOf(await entryOf(lent.entryId))).toEqual([
      ['455', 0, 500_000, null],
      ['5121', 500_000, 0, null],
    ])

    // A supplier refund reverses the charge and its VAT
    const refund = await transaction(a, 'VIR FREE PRO REMBOURSEMENT', 47.99)
    expect((await list()).items.find((i: { id: string }) => i.id === refund.id).suggestion).toMatchObject({ categoryId: 'remboursement:telephone-internet', confidence: 'medium' })
    const reversed = await (await confirm('owner', refund.id)).json()
    expect(reversed.learnedRule).toBeNull()
    expect(linesOf(await entryOf(reversed.entryId))).toEqual([
      ['44566', 0, 800, null],
      ['5121', 4_799, 0, null],
      ['626', 0, 3_999, null],
    ])

    // A VAT refund books to 44567 only, never to its parent 4456
    const vat = await transaction(a, 'VIR SEPA DGFIP REMBOURSEMENT CREDIT TVA', 1843)
    const noAccount = await confirm('owner', vat.id)
    expect(noAccount.status).toBe(400)
    expect((await noAccount.json()).error).toMatch(new RegExp(`^La catégorie «${N}Remboursement de TVA${N}» n'a pas de compte`))
    await prisma.account.create({ data: { companyId: a.id, fiscalYearId: a.fiscalYearId, code: '44567', label: 'Crédit de TVA à reporter' } })
    const refunded = await (await confirm('owner', vat.id)).json()
    expect(linesOf(await entryOf(refunded.entryId))).toEqual([
      ['44567', 0, 184_300, null],
      ['5121', 184_300, 0, null],
    ])
  })

  it('refuses an expense category for money in, an invoice for money out, and an amount above what is left to pay', async () => {
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000)
    const credit = await transaction(a, 'VIR SEPA CLIENT', 1200)
    const expense = await confirm('owner', credit.id, { categoryId: 'telephone-internet' })
    expect(expense.status).toBe(400)
    expect((await expense.json()).error).toBe(`«${N}Téléphone et internet${N}» est une dépense, et cette opération une entrée d’argent${N}: choisissez une recette, ou le remboursement de cette dépense.`)
    const debit = await transaction(a, 'PRLV STUDIO NORD', 1200, { side: 'debit' })
    const out = await confirm('owner', debit.id, { invoiceId: invoice.id })
    expect(out.status).toBe(400)
    const income = await confirm('owner', debit.id, { categoryId: 'ventes-prestations' })
    expect(income.status).toBe(400)
    const tooMuch = await transaction(a, 'VIR SEPA STUDIO NORD', 1500)
    const above = await confirm('owner', tooMuch.id, { invoiceId: invoice.id })
    expect(above.status).toBe(400)
    expect((await above.json()).error).toBe(`Ce paiement de 1 500,00 € dépasse ce qui reste à payer sur la facture n° F-2026-012 (1 200,00 €)${N}: s’il règle plusieurs factures, votre comptable le répartira.`)
    expect(await prisma.accountingEntry.count({ where: { companyId: a.id, journal: { code: 'BQ' } } })).toBe(0)
  })

  it('answers 404 for an invoice or a transaction of another company, 403 for a read-only member', async () => {
    const mine = await salesInvoice(a, 'F-2026-012', 100_000)
    const theirs = await salesInvoice(b, 'F-2026-012', 100_000)
    const credit = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    const foreign = await confirm('owner', credit.id, { invoiceId: theirs.id })
    expect(foreign.status).toBe(404)
    expect((await foreign.json()).error).toBe('Facture introuvable')
    const theirCredit = await transaction(b, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    expect((await confirm('owner', theirCredit.id, { invoiceId: mine.id })).status).toBe(404)
    expect((await confirm('outsider', credit.id, { invoiceId: mine.id })).status).toBe(404)
    expect((await confirm('viewer', credit.id, { invoiceId: mine.id })).status).toBe(403)
    expect(await settlement(mine.id)).toMatchObject({ paidCents: 0 })
    expect(await settlement(theirs.id)).toMatchObject({ paidCents: 0 })
  })

  it('confirms the sure invoice payments in bulk and leaves the others', async () => {
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000)
    const sure = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    const unsure = await transaction(a, 'REMISE CHEQUE 1234567', 80)
    const response = await call('owner', 'confirmAll', 'POST', '/api/simple/expenses/confirm-all', { body: { companyId: a.id, transactionIds: [sure.id, unsure.id] } })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.confirmed).toEqual([expect.objectContaining({ transactionId: sure.id, invoice: expect.objectContaining({ id: invoice.id, recorded: true, lettered: true }) })])
    expect(result.skipped).toEqual([{ transactionId: unsure.id, reason: 'Kledg n’est pas assez sûr de la catégorie : vérifiez-la.'.replace(' :', `${N}:`) }])
  })

  it('reopens the invoice when the reconciliation of a draft payment is undone, and keeps the invoice posted until then', async () => {
    await addAccountant()
    const invoice = await salesInvoice(a, 'F-2026-012', 100_000, { validate: false })
    const paid = await transaction(a, 'VIR SEPA STUDIO NORD FACT F-2026-012', 1200)
    const { entryId } = await (await confirm('owner', paid.id)).json()
    expect(await receipts.loadOpenSalesInvoices(a.id)).toEqual([])
    await expect(postingSvc.unpostInvoice(a.id, invoice.id)).rejects.toThrow(/confirmé dans les recettes à vérifier/)
    const undo = await call('accountant', 'reconcile', 'DELETE', `/api/transactions/${paid.id}/reconcile`, { params: { id: paid.id } })
    expect(undo.status).toBe(200)
    expect(await prisma.accountingEntry.count({ where: { id: entryId } })).toBe(0)
    expect((await receipts.loadOpenSalesInvoices(a.id)).map((i) => [i.id, i.remainingCents])).toEqual([[invoice.id, 120_000]])
    await postingSvc.unpostInvoice(a.id, invoice.id)
    await invoicesSvc.deleteInvoice(a.id, invoice.id)
  })
})
