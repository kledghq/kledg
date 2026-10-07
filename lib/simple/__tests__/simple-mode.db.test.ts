/**
 * Simple mode against PostgreSQL (docs/categories-simples.md), through the
 * real routes with only the session mocked, on the PCG chart Kledg seeds:
 * - the list proposes categories (payee dictionary, rules learned) and
 *   counts the lines to review;
 * - confirming creates a balanced entry (bank 512 line, charge, VAT),
 *   reconciled with the transaction, validated at once without accountant
 *   review, a draft "à valider" with an accountant member or the setting;
 * - a question must be answered (400 with the question), a fixed asset goes
 *   to 2183 with its VAT on 44562;
 * - a second confirmation is a 409, another company's transaction a 404, a
 *   read-only member a 403;
 * - "Tout confirmer" confirms only high confidence lines;
 * - three identical choices create a transaction rule, used next time;
 * - the accountant lists the entries, validates them through the usual
 *   route, and the summary follows;
 * - undoing the reconciliation removes the draft and its origin row.
 * Run with KLEDG_RLS=enforce too (docs/rls.md).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('simple_mode')
  return { user: null as { id: string; email: string; name: string; role: string } | null }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: typeof import('@/lib/prisma').prisma
let simple: typeof import('@/lib/simple/expenses-to-review.service')
let confirmService: typeof import('@/lib/simple/confirm-expense.service')
let validation: typeof import('@/lib/simple/simple-validation.service')
const routes = {} as Record<string, Module>

const USERS = {
  owner: { id: 'u-owner', email: 'claire@test.local', name: 'Claire Petit', role: 'user' },
  accountant: { id: 'u-acc', email: 'marc@test.local', name: 'Marc Renaud', role: 'user' },
  viewer: { id: 'u-view', email: 'view@test.local', name: 'Lecture', role: 'user' },
  outsider: { id: 'u-out', email: 'out@test.local', name: 'Autre société', role: 'user' },
}
type Who = keyof typeof USERS

async function call(as: Who, route: string, method: string, path: string, options: { body?: unknown; params?: Record<string, string>; form?: FormData } = {}) {
  state.user = USERS[as]
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(options.form ? { body: options.form } : options.body === undefined ? {} : { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } }),
  })
  return routes[route][method](request, { params: Promise.resolve(options.params ?? {}) })
}

interface Company {
  id: string
  fiscalYearId: string
  bankAccountId: string
}

let seq = 0

async function seedCompany(slug: string, siren: string): Promise<Company> {
  const { seedPCG } = await import('@/prisma/seeds/pcg')
  const company = await prisma.company.create({ data: { name: slug, slug, siren } })
  const fy = await prisma.fiscalYear.create({
    data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
  })
  await seedPCG(company.id, fy.id, false)
  await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const connection = await prisma.bankConnection.create({ data: { companyId: company.id, provider: 'MANUAL' } })
  const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: `acc-${slug}`, name: 'Compte courant' } })
  return { id: company.id, fiscalYearId: fy.id, bankAccountId: bankAccount.id }
}

async function transaction(company: Company, label: string, amount: number, options: { day?: string; side?: 'debit' | 'credit'; counterpartyName?: string } = {}) {
  seq += 1
  return prisma.bankTransaction.create({
    data: {
      bankAccountId: company.bankAccountId,
      externalTransactionId: `simple-${seq}`,
      amount,
      date: new Date(`${options.day ?? '2026-03-10'}T00:00:00Z`),
      side: options.side ?? 'debit',
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

const linesOf = (entry: Awaited<ReturnType<typeof entryOf>>) =>
  entry.lines
    .map((l) => [l.account.code, Number(l.debit.toString()) * 100, Number(l.credit.toString()) * 100].map((v) => (typeof v === 'number' ? Math.round(v) : v)))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

describe.skipIf(!available)('simple mode (PostgreSQL)', () => {
  let a: Company
  let b: Company

  beforeAll(async () => {
    await prepareTestDatabase('simple_mode')
    ;({ prisma } = await import('@/lib/prisma'))
    simple = await import('@/lib/simple/expenses-to-review.service')
    confirmService = await import('@/lib/simple/confirm-expense.service')
    validation = await import('@/lib/simple/simple-validation.service')
    Object.assign(routes, {
      list: await import('@/app/api/simple/expenses/route'),
      confirm: await import('@/app/api/simple/expenses/[id]/confirm/route'),
      confirmAll: await import('@/app/api/simple/expenses/confirm-all/route'),
      receipt: await import('@/app/api/simple/expenses/[id]/receipt/route'),
      entries: await import('@/app/api/simple/entries/route'),
      settings: await import('@/app/api/companies/[id]/simple-mode-settings/route'),
      bulkValidate: await import('@/app/api/entries/bulk-validate/route'),
      reconcile: await import('@/app/api/transactions/[id]/reconcile/route'),
    })
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('simple_mode')
    a = await seedCompany('atelier-lumen', '940000501')
    b = await seedCompany('autre-societe', '940000502')
    await seedMembership(prisma, USERS.owner.id, a.id, 'companyAdmin')
    await seedMembership(prisma, USERS.viewer.id, a.id, 'viewer')
    await seedMembership(prisma, USERS.outsider.id, b.id, 'companyAdmin')
    await prisma.user.update({ where: { id: USERS.owner.id }, data: { name: USERS.owner.name } })
  }, 60_000)

  async function addAccountant() {
    await seedMembership(prisma, USERS.accountant.id, a.id, 'accountant')
    await prisma.user.update({ where: { id: USERS.accountant.id }, data: { name: USERS.accountant.name } })
  }

  const confirm = (as: Who, id: string, body: unknown = {}) => call(as, 'confirm', 'POST', `/api/simple/expenses/${id}/confirm`, { body, params: { id } })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('lists the payments to review with their suggestion, for a read-only member too', async () => {
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99, { day: '2026-10-01' })
    await transaction(a, 'CB SARL DUBOIS', 120, { day: '2026-09-20' })
    await transaction(a, 'VIR CLIENT MARTIN', 1200, { side: 'credit' })
    await transaction(b, 'PRLV SEPA FREE PRO', 47.99)

    const response = await call('viewer', 'list', 'GET', `/api/simple/expenses?companyId=atelier-lumen`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await response.json()
    expect(body.count).toBe(2)
    expect(body.items[0]).toMatchObject({
      id: free.id,
      date: '2026-10-01',
      side: 'debit',
      amountCents: 4_799,
      name: 'Free Pro',
      suggestion: { categoryId: 'telephone-internet', confidence: 'high', source: 'payee', bulkConfirmable: true },
      hasReceipt: false,
      canUploadReceipt: false,
      blockedReason: null,
    })
    expect(body.items[1].suggestion).toMatchObject({ categoryId: null, confidence: 'low' })
    expect(body.bulkConfirmableIds).toEqual([free.id])
    expect(body.review).toEqual({ accountantReview: false, setting: null, accountants: [] })
    expect(await simple.countExpensesToReview(a.id)).toBe(2)
    expect(await simple.countExpensesToReview(a.id, 'credit')).toBe(1)

    const outsider = await call('outsider', 'list', 'GET', `/api/simple/expenses?companyId=atelier-lumen`)
    expect(outsider.status).toBe(404)
  })

  it('without an accountant, validates the entry at once: balanced, reconciled, bank and VAT lines', async () => {
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    const response = await confirm('owner', free.id)
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result).toMatchObject({ transactionId: free.id, status: 'validated', needsReview: false, categoryId: 'telephone-internet', learnedRule: null })
    expect(result.entryNumber).not.toMatch(/^BR-/)

    const entry = await entryOf(result.entryId)
    expect(entry.status).toBe('validated')
    expect(entry.sourceBankTransactionId).toBe(free.id)
    expect(linesOf(entry)).toEqual([
      ['44566', 800, 0],
      ['5121', 0, 4_799],
      ['626', 3_999, 0],
    ])
    const debit = entry.lines.reduce((s, l) => s + Math.round(Number(l.debit.toString()) * 100), 0)
    const credit = entry.lines.reduce((s, l) => s + Math.round(Number(l.credit.toString()) * 100), 0)
    expect(debit).toBe(credit)
    expect(entry.simpleModeEntry).toMatchObject({ companyId: a.id, categoryId: 'telephone-internet', counterpartyKey: 'FREE PRO', needsReview: false, source: 'web', createdById: USERS.owner.id })
    const tx = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: free.id } })
    expect(tx).toMatchObject({ reconciled: true, reconciledWith: entry.id })

    // A second confirmation is refused
    const again = await confirm('owner', free.id)
    expect(again.status).toBe(409)
    expect(await prisma.accountingEntry.count({ where: { companyId: a.id } })).toBe(1)
  })

  it('self-assesses the VAT of a foreign supplier and deducts the VAT the bank read on bank fees (R3 QUAL-03, QUAL-13)', async () => {
    // Notion bills a French business without French VAT: 20 % self-assessed (CGI art. 259, 1° and 283, 2)
    const notion = await transaction(a, 'CB NOTION LABS INC', 10)
    const response = await confirm('owner', notion.id)
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result).toMatchObject({ categoryId: 'logiciels', status: 'validated' })
    expect(linesOf(await entryOf(result.entryId))).toEqual([
      ['4452', 0, 200],
      ['44566', 200, 0],
      ['5121', 0, 1_000],
      ['6511', 1_000, 0],
    ])
    // Qonto read 2,00 € of VAT on its 12,00 € plan
    seq += 1
    const qonto = await prisma.bankTransaction.create({
      data: { bankAccountId: a.bankAccountId, externalTransactionId: `simple-${seq}`, amount: 12, date: new Date('2026-03-10T00:00:00Z'), side: 'debit', label: 'QONTO ABONNEMENT ESSENTIAL', vatAmount: 2, vatRate: 20 },
    })
    const fees = await (await confirm('owner', qonto.id)).json()
    expect(fees).toMatchObject({ categoryId: 'frais-bancaires' })
    expect(linesOf(await entryOf(fees.entryId))).toEqual([
      ['44566', 200, 0],
      ['5121', 0, 1_200],
      ['627', 1_000, 0],
    ])
  })

  it('with an accountant member, leaves a draft to validate, which the accountant validates through the usual route', async () => {
    await addAccountant()
    const meal = await transaction(a, 'CB LE PETIT BISTROT', 64.5, { day: '2026-09-25' })
    const response = await confirm('owner', meal.id, { categoryId: 'repas-affaires', note: 'Déjeuner avec Studio Nord' })
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result).toMatchObject({ status: 'draft', needsReview: true })
    const entry = await entryOf(result.entryId)
    expect(entry.status).toBe('draft')
    expect(linesOf(entry)).toEqual([
      ['44566', 586, 0],
      ['5121', 0, 6_450],
      ['6257', 5_864, 0],
    ])
    expect(entry.simpleModeEntry).toMatchObject({ note: 'Déjeuner avec Studio Nord', answers: { 'meal-guests': 'guests' }, needsReview: true })

    // The accountant's view
    const list = await call('accountant', 'entries', 'GET', `/api/simple/entries?companyId=${a.id}&from=2026-09-01&to=2026-09-30`)
    expect(list.status).toBe(200)
    const view = await list.json()
    expect(view.items).toEqual([
      expect.objectContaining({
        entryId: entry.id,
        status: 'draft',
        name: 'Petit Bistrot',
        categoryLabel: "Repas d'affaires",
        answerLabels: ['Avec qui était ce repas ? Avec des clients ou partenaires'],
        note: 'Déjeuner avec Studio Nord',
        amountCents: 6_450,
        hasReceipt: false,
      }),
    ])
    expect(view.summary).toMatchObject({ classifiedCount: 1, validatedCount: 0, toValidateCount: 1, accountantReview: true, accountants: [{ name: 'Marc Renaud' }] })

    const validated = await call('accountant', 'bulkValidate', 'POST', '/api/entries/bulk-validate', { body: { companyId: a.id, entryIds: [entry.id], status: 'validated' } })
    expect(validated.status).toBe(200)
    expect((await entryOf(entry.id)).status).toBe('validated')
    expect(await validation.simpleValidationSummary(a.id, { from: '2026-09-01', to: '2026-09-30' })).toMatchObject({ classifiedCount: 1, validatedCount: 1, toValidateCount: 0 })
    expect(await validation.simpleValidationSummary(a.id, { from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ classifiedCount: 0 })
  })

  it('follows the company setting: off validates at once even with an accountant, on keeps drafts without one', async () => {
    await addAccountant()
    const read = await call('owner', 'settings', 'GET', `/api/companies/${a.id}/simple-mode-settings`, { params: { id: a.id } })
    expect(await read.json()).toEqual({ accountantReview: true, setting: null, accountants: [{ name: 'Marc Renaud' }] })
    // The accountant reads the setting but does not change it (settings:update)
    expect((await call('accountant', 'settings', 'PUT', `/api/companies/${a.id}/simple-mode-settings`, { params: { id: a.id }, body: { accountantReview: false } })).status).toBe(403)
    const off = await call('owner', 'settings', 'PUT', `/api/companies/${a.id}/simple-mode-settings`, { params: { id: a.id }, body: { accountantReview: false } })
    expect(off.status).toBe(200)
    expect(await off.json()).toMatchObject({ accountantReview: false, setting: false })

    const first = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    expect((await (await confirm('owner', first.id)).json()).status).toBe('validated')

    await call('owner', 'settings', 'PUT', `/api/companies/${a.id}/simple-mode-settings`, { params: { id: a.id }, body: { accountantReview: true } })
    await prisma.member.deleteMany({ where: { userId: USERS.accountant.id } })
    const second = await transaction(a, 'PRLV SEPA FREE PRO', 47.99, { day: '2026-04-10' })
    expect((await (await confirm('owner', second.id)).json())).toMatchObject({ status: 'draft', needsReview: true })

    // Back to the default: no accountant, validated at once
    await call('owner', 'settings', 'PUT', `/api/companies/${a.id}/simple-mode-settings`, { params: { id: a.id }, body: { accountantReview: null } })
    const third = await transaction(a, 'PRLV SEPA FREE PRO', 47.99, { day: '2026-05-10' })
    expect((await (await confirm('owner', third.id)).json()).status).toBe('validated')
  })

  it('asks the durable question for a computer above 500 € HT and books it as a fixed asset', async () => {
    const mac = await transaction(a, 'CB APPLE STORE OPERA', 1499)
    const unanswered = await confirm('owner', mac.id)
    expect(unanswered.status).toBe(400)
    const refusal = await unanswered.json()
    expect(refusal.error).toBe("Répondez d'abord à la question : Allez-vous l'utiliser plus d'un an ?")
    expect(refusal.question.id).toBe('durable')

    const response = await confirm('owner', mac.id, { categoryId: 'materiel-informatique', answers: { durable: 'durable' } })
    expect(response.status).toBe(201)
    const entry = await entryOf((await response.json()).entryId)
    expect(linesOf(entry)).toEqual([
      ['2183', 124_917, 0],
      ['44562', 24_983, 0],
      ['5121', 0, 149_900],
    ])
  })

  it('answers 404 for another company, 403 for a read-only member, 400 for an unknown category', async () => {
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    expect((await confirm('outsider', free.id)).status).toBe(404)
    expect((await confirm('viewer', free.id)).status).toBe(403)
    const unknown = await confirm('owner', free.id, { categoryId: 'pas-une-categorie' })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error).toBe(confirmService.MESSAGES.unknownCategory)
    // A line Kledg cannot classify needs a category
    const dubois = await transaction(a, 'CB SARL DUBOIS', 120)
    const nothing = await confirm('owner', dubois.id)
    expect(nothing.status).toBe(400)
    expect((await nothing.json()).error).toBe(confirmService.MESSAGES.nothingToConfirm)
    expect(await prisma.accountingEntry.count()).toBe(0)
  })

  it('confirms in bulk only the high confidence lines without a question', async () => {
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    const urssaf = await transaction(a, 'PRLV SEPA URSSAF ILE DE FRANCE', 980)
    const mac = await transaction(a, 'CB APPLE STORE OPERA', 1499)
    const foreign = await transaction(b, 'PRLV SEPA FREE PRO', 47.99)
    const response = await call('owner', 'confirmAll', 'POST', '/api/simple/expenses/confirm-all', { body: { companyId: a.id, transactionIds: [free.id, urssaf.id, mac.id, foreign.id] } })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.confirmed.map((r: { transactionId: string }) => r.transactionId)).toEqual([free.id])
    expect(result.skipped).toEqual([
      { transactionId: urssaf.id, reason: 'Kledg n’est pas assez sûr de la catégorie : vérifiez-la.' },
      { transactionId: mac.id, reason: 'Une question attend votre réponse.' },
      { transactionId: foreign.id, reason: 'Transaction introuvable' },
    ])
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: foreign.id } })).reconciled).toBe(false)
    expect((await call('viewer', 'confirmAll', 'POST', '/api/simple/expenses/confirm-all', { body: { companyId: a.id, transactionIds: [urssaf.id] } })).status).toBe(403)
  })

  it('learns a rule after three identical choices and suggests it next time', async () => {
    const days = ['2026-03-05', '2026-04-05', '2026-05-05']
    let learned: { id: string; name: string; created: boolean } | null = null
    for (const day of days) {
      const t = await transaction(a, 'VIR SEPA SARL DUBOIS FACTURE', 600, { day, counterpartyName: 'SARL Dubois' })
      const result = await (await confirm('owner', t.id, { categoryId: 'sous-traitance' })).json()
      learned = result.learnedRule
    }
    expect(learned).toMatchObject({ name: 'SARL Dubois (mode simple)', created: true })
    const rule = await prisma.transactionRule.findUniqueOrThrow({ where: { id: learned!.id }, include: { conditions: true, entryLines: true } })
    expect(rule).toMatchObject({ companyId: a.id, autoCreate: false, journalCode: 'BQ' })
    expect(rule.conditions.map((c) => [c.conditionType, c.operator, c.value])).toEqual([
      ['counterparty', 'equals', 'SARL Dubois'],
      ['side', 'equals', 'debit'],
    ])
    expect(rule.entryLines).toEqual([expect.objectContaining({ accountCode: '611', vatType: 'deductible', vatAccountCode: '44566', vatRateSource: 'transaction' })])

    const next = await transaction(a, 'VIR SEPA SARL DUBOIS FACTURE', 360, { day: '2026-06-05', counterpartyName: 'SARL Dubois' })
    const list = await (await call('owner', 'list', 'GET', `/api/simple/expenses?companyId=${a.id}`)).json()
    expect(list.items[0].suggestion).toMatchObject({ source: 'rule', ruleId: rule.id, categoryId: 'sous-traitance', confidence: 'high' })
    const confirmed = await (await confirm('owner', next.id)).json()
    expect(confirmed).toMatchObject({ ruleId: rule.id, categoryId: 'sous-traitance' })
    expect(linesOf(await entryOf(confirmed.entryId))).toEqual([
      ['44566', 6_000, 0],
      ['5121', 0, 36_000],
      ['611', 30_000, 0],
    ])
    expect((await prisma.transactionRule.findUniqueOrThrow({ where: { id: rule.id } })).usageCount).toBe(1)

    // A different choice three times updates the rule simple mode created
    for (const day of ['2026-07-05', '2026-08-05', '2026-09-05']) {
      const t = await transaction(a, 'VIR SEPA SARL DUBOIS FACTURE', 600, { day, counterpartyName: 'SARL Dubois' })
      await confirm('owner', t.id, { categoryId: 'honoraires' })
    }
    const updated = await prisma.transactionRule.findUniqueOrThrow({ where: { id: rule.id }, include: { entryLines: true } })
    expect(updated.entryLines.map((l) => l.accountCode)).toEqual(['6226'])
    expect(await prisma.transactionRule.count({ where: { companyId: a.id } })).toBe(1)
  })

  it('confirms as a draft for an assistant (MCP), never validated', async () => {
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    const result = await confirmService.confirmExpense(a.id, free.id, { learn: false }, { userId: USERS.owner.id, canValidate: true, source: 'mcp' })
    expect(result).toMatchObject({ status: 'draft', needsReview: false })
    expect((await entryOf(result.entryId)).simpleModeEntry?.source).toBe('mcp')
  })

  it('undoing the reconciliation removes the draft and its simple mode row', async () => {
    await addAccountant()
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    const { entryId } = await (await confirm('owner', free.id)).json()
    const undo = await call('accountant', 'reconcile', 'DELETE', `/api/transactions/${free.id}/reconcile`, { params: { id: free.id } })
    expect(undo.status).toBe(200)
    expect(await prisma.accountingEntry.count({ where: { id: entryId } })).toBe(0)
    expect(await prisma.simpleModeEntry.count()).toBe(0)
    expect(await simple.countExpensesToReview(a.id)).toBe(1)
  })

  it('refuses a receipt for a bank Kledg cannot send it to', async () => {
    const free = await transaction(a, 'PRLV SEPA FREE PRO', 47.99)
    const form = new FormData()
    form.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'facture.pdf', { type: 'application/pdf' }))
    const response = await call('owner', 'receipt', 'POST', `/api/simple/expenses/${free.id}/receipt`, { params: { id: free.id }, form })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^Votre banque ne permet pas/)
    expect((await call('viewer', 'receipt', 'POST', `/api/simple/expenses/${free.id}/receipt`, { params: { id: free.id }, form: new FormData() })).status).toBe(403)
  })
})
