/**
 * Chart of accounts and journal routes against PostgreSQL (session and
 * roles mocked): status codes, French messages and response shapes the UI
 * reads, and what the routes change in the database. Skipped without the
 * test database server.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const member = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('ledger_routes')
  return { companyId: '' }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'compta@example.com', name: null, role: null }),
}))
vi.mock('@/lib/rbac/authorize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rbac/authorize')>('@/lib/rbac/authorize')
  // Member of the test company only: resources of the other company answer 404
  return {
    ...actual,
    getUserRolesForCompany: vi.fn(async (_userId: string, companyId: string) => (companyId === member.companyId ? ['companyAdmin'] : [])),
    isGlobalAdmin: vi.fn().mockReturnValue(false),
  }
})
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { seedMembership } from '@/lib/__tests__/helpers/membership'
import { isOptionalPcgAccount } from '@/lib/accounting/pcg-data'

const available = await testDatabaseAvailable()

type Handler = (request: NextRequest, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Routes = Record<string, Handler>
let prisma: typeof import('@/lib/prisma').prisma
const r = {} as Record<
  'accounts' | 'account' | 'accountEntries' | 'balanceEvolution' | 'checkExists' | 'compliance' | 'deleteNonPcg' | 'seedPcg' | 'journals' | 'journal',
  Routes
>
const ids = {} as Record<string, string>

function call(handler: Handler, method: string, path: string, body?: unknown, params?: Record<string, string>) {
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    ...(body instanceof FormData
      ? { body }
      : body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  return handler(request, params ? { params: Promise.resolve(params) } : undefined)
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown> & { error?: string }
}

async function account(code: string, label: string, options: { parentId?: string; isPCG?: boolean; fiscalYearId?: string } = {}) {
  return prisma.account.create({
    data: {
      companyId: ids.company,
      fiscalYearId: options.fiscalYearId ?? ids.fy,
      code,
      label,
      parentId: options.parentId,
      isPCG: options.isPCG ?? false,
    },
  })
}

/** A draft entry with one line on each account (debit on the first). */
async function entryOn(debitAccountId: string, creditAccountId: string, amount: string, entryNumber: string, date = '2026-02-01') {
  const entry = await prisma.accountingEntry.create({
    data: {
      companyId: ids.company,
      fiscalYearId: ids.fy,
      journalId: ids.journal,
      entryNumber,
      date: new Date(`${date}T00:00:00Z`),
      description: 'Test',
      status: 'draft',
    },
  })
  await prisma.entryLine.createMany({
    data: [
      { accountingEntryId: entry.id, accountingEntryNumber: entryNumber, accountId: debitAccountId, accountFiscalYearId: ids.fy, debit: amount, credit: 0 },
      { accountingEntryId: entry.id, accountingEntryNumber: entryNumber, accountId: creditAccountId, accountFiscalYearId: ids.fy, debit: 0, credit: amount },
    ],
  })
  return entry
}

describe.skipIf(!available)('chart of accounts and journal routes', () => {
  beforeAll(async () => {
    await prepareTestDatabase('ledger_routes')
    ;({ prisma } = await import('@/lib/prisma'))
    Object.assign(r, {
      accounts: await import('@/app/api/accounts/route'),
      account: await import('@/app/api/accounts/[id]/route'),
      accountEntries: await import('@/app/api/accounts/[id]/entries/route'),
      balanceEvolution: await import('@/app/api/accounts/[id]/balance-evolution/route'),
      checkExists: await import('@/app/api/accounts/check-exists/route'),
      compliance: await import('@/app/api/accounts/check-pcg-compliance/route'),
      deleteNonPcg: await import('@/app/api/accounts/delete-non-pcg/route'),
      seedPcg: await import('@/app/api/accounts/seed-pcg/route'),
      journals: await import('@/app/api/journals/route'),
      journal: await import('@/app/api/journals/[id]/route'),
    })
  })

  beforeEach(async () => {
    await prepareTestDatabase('ledger_routes')
    const company = await prisma.company.create({ data: { name: 'Atelier', slug: 'atelier', siren: '123456789' } })
    // The mocked session user is a member in the database too (row level security).
    await seedMembership(prisma, 'user-1', company.id)
    const other = await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '987654321' } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
    })
    const fy2 = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2027, startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-12-31T00:00:00Z') },
    })
    const otherFy = await prisma.fiscalYear.create({
      data: { companyId: other.id, year: 2026, startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-12-31T00:00:00Z') },
    })
    const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'Opérations diverses' } })
    const otherJournal = await prisma.journal.create({ data: { companyId: other.id, code: 'OD', label: 'Opérations diverses' } })
    member.companyId = company.id
    Object.assign(ids, { company: company.id, other: other.id, fy: fy.id, fy2: fy2.id, otherFy: otherFy.id, journal: journal.id, otherJournal: otherJournal.id })
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('journals', () => {
    it('lists the journals of the company only, without creating any', async () => {
      const first = await call(r.journals.GET, 'GET', `/api/journals?companyId=${ids.company}`)
      expect(first.status).toBe(200)
      const journals = (await first.json()) as Array<{ id: string; code: string; companyId: string }>
      expect(journals.map((j) => j.code)).toEqual(['OD'])
      expect(journals.every((j) => j.companyId === ids.company)).toBe(true)
      await call(r.journals.GET, 'GET', `/api/journals?companyId=${ids.company}`)
      // Reading never adds journals (the defaults are created with the company)
      expect(await prisma.journal.count({ where: { companyId: ids.company } })).toBe(1)
    })

    it('creates a journal with a normalized code (201), refuses a duplicate (409) and a bad code (400)', async () => {
      const created = await call(r.journals.POST, 'POST', '/api/journals', { companyId: ids.company, code: 'bq2', label: 'Banque 2' })
      expect(created.status).toBe(201)
      expect(await json(created)).toMatchObject({ code: 'BQ2', label: 'Banque 2', companyId: ids.company })

      const duplicate = await call(r.journals.POST, 'POST', '/api/journals', { companyId: ids.company, code: 'BQ2', label: 'Encore' })
      expect(duplicate.status).toBe(409)
      expect((await json(duplicate)).error).toMatch(/existe déjà/)

      const bad = await call(r.journals.POST, 'POST', '/api/journals', { companyId: ids.company, code: 'BANQUE', label: 'Banque' })
      expect(bad.status).toBe(400)
      expect((await json(bad)).error).toMatch(/2 à 3 caractères/)

      const missing = await call(r.journals.POST, 'POST', '/api/journals', { companyId: ids.company, label: 'Banque' })
      expect(missing.status).toBe(400)
      expect((await json(missing)).error).toMatch(/Le code est requis/)
    })

    it('renames and recodes a journal, refusing a code in use (409)', async () => {
      await prisma.journal.create({ data: { companyId: ids.company, code: 'BQ', label: 'Banque' } })
      const params = { id: ids.journal }
      const renamed = await call(r.journal.PATCH, 'PATCH', `/api/journals/${ids.journal}`, { code: 'od2', label: 'Divers' }, params)
      expect(renamed.status).toBe(200)
      expect(await json(renamed)).toMatchObject({ code: 'OD2', label: 'Divers' })

      const taken = await call(r.journal.PATCH, 'PATCH', `/api/journals/${ids.journal}`, { code: 'BQ' }, params)
      expect(taken.status).toBe(409)
      expect((await json(taken)).error).toBe('Un journal avec le code BQ existe déjà pour cette société')

      const blank = await call(r.journal.PATCH, 'PATCH', `/api/journals/${ids.journal}`, { label: '  ' }, params)
      expect(blank.status).toBe(400)
    })

    it('answers 404 for a journal of another company', async () => {
      const params = { id: ids.otherJournal }
      expect((await call(r.journal.PATCH, 'PATCH', `/api/journals/${ids.otherJournal}`, { label: 'x' }, params)).status).toBe(404)
      expect((await call(r.journal.DELETE, 'DELETE', `/api/journals/${ids.otherJournal}`, undefined, params)).status).toBe(404)
    })

    it('deletes an empty journal and refuses one with entries (409)', async () => {
      const a = await account('512000', 'Banque')
      const b = await account('706000', 'Ventes')
      await entryOn(a.id, b.id, '10.00', 'BR-1')
      const used = await call(r.journal.DELETE, 'DELETE', `/api/journals/${ids.journal}`, undefined, { id: ids.journal })
      expect(used.status).toBe(409)
      expect((await json(used)).error).toMatch(/des écritures comptables y sont liées/)

      const empty = await prisma.journal.create({ data: { companyId: ids.company, code: 'CA', label: 'Caisse' } })
      const deleted = await call(r.journal.DELETE, 'DELETE', `/api/journals/${empty.id}`, undefined, { id: empty.id })
      expect(deleted.status).toBe(200)
      expect(await json(deleted)).toEqual({ success: true })
      expect(await prisma.journal.findUnique({ where: { id: empty.id } })).toBeNull()
    })
  })

  describe('accounts', () => {
    it('lists the chart of the requested fiscal year, by number', async () => {
      await account('706000', 'Ventes')
      await account('512000', 'Banque')
      await account('401000', 'Fournisseurs', { fiscalYearId: ids.fy2 })
      const response = await call(r.accounts.GET, 'GET', `/api/accounts?companyId=${ids.company}&fiscalYearId=${ids.fy}`)
      expect(response.status).toBe(200)
      expect(((await response.json()) as Array<{ code: string }>).map((a) => a.code)).toEqual(['512000', '706000'])
    })

    it('says whether a number exists in a chart, and requires the number', async () => {
      await account('512000', 'Banque')
      const yes = await call(r.checkExists.GET, 'GET', `/api/accounts/check-exists?companyId=${ids.company}&fiscalYearId=${ids.fy}&code=512000`)
      expect(await json(yes)).toMatchObject({ exists: true, account: { code: '512000', label: 'Banque' } })
      const no = await call(r.checkExists.GET, 'GET', `/api/accounts/check-exists?companyId=${ids.company}&fiscalYearId=${ids.fy2}&code=512000`)
      expect(await json(no)).toEqual({ exists: false, account: null })
      const missing = await call(r.checkExists.GET, 'GET', `/api/accounts/check-exists?companyId=${ids.company}`)
      expect(missing.status).toBe(400)
      expect((await json(missing)).error).toMatch(/Le numéro de compte est requis/)
    })

    it('creates a sub-account (201) and validates the body', async () => {
      const parent = await account('512', 'Banques', { isPCG: true })
      const created = await call(r.accounts.POST, 'POST', '/api/accounts', {
        companyId: ids.company,
        code: '512100',
        label: 'Banque Alpha',
        parentId: parent.id,
        fiscalYearId: ids.fy,
      })
      expect(created.status).toBe(201)
      expect(await json(created)).toMatchObject({ code: '512100', isPCG: true, fiscalYearId: ids.fy })

      const noParent = await call(r.accounts.POST, 'POST', '/api/accounts', { companyId: ids.company, code: '512200', label: 'x' })
      expect(noParent.status).toBe(400)
      expect((await json(noParent)).error).toMatch(/Le compte parent est requis/)
    })

    it('gets an account of the company and answers 404 for another company', async () => {
      const bank = await account('512000', 'Banque')
      const got = await call(r.account.GET, 'GET', `/api/accounts/${bank.id}`, undefined, { id: bank.id })
      expect(await json(got)).toEqual({
        id: bank.id,
        code: '512000',
        label: 'Banque',
        companyId: ids.company,
        isPCG: false,
        parentId: null,
        fiscalYearId: ids.fy,
      })
      const foreign = await prisma.account.create({ data: { companyId: ids.other, fiscalYearId: ids.otherFy, code: '512000', label: 'Banque' } })
      const response = await call(r.account.GET, 'GET', `/api/accounts/${foreign.id}`, undefined, { id: foreign.id })
      expect(response.status).toBe(404)
    })

    it('updates an account under the PCG rules', async () => {
      const parent512 = await account('512', 'Banques', { isPCG: true })
      const pcg = await account('5121', 'Comptes en euros', { isPCG: true })
      const mine = await account('51210', 'Banque Alpha')
      const otherYearParent = await account('512', 'Banques', { isPCG: true, fiscalYearId: ids.fy2 })
      const patch = (id: string, body: unknown) => call(r.account.PATCH, 'PATCH', `/api/accounts/${id}`, body, { id })

      const recode = await patch(pcg.id, { code: '5122' })
      expect(recode.status).toBe(400)
      expect((await json(recode)).error).toBe('Pour un compte du PCG, le code ne peut pas être modifié.')

      const relabel = await patch(pcg.id, { code: '5121', label: 'Euros' })
      expect(relabel.status).toBe(200)
      expect(await json(relabel)).toMatchObject({ code: '5121', label: 'Euros' })

      expect((await patch(mine.id, { code: '5121' })).status).toBe(409)
      expect((await patch(mine.id, { code: '5x' })).status).toBe(400)
      expect((await patch(mine.id, { label: ' ' })).status).toBe(400)
      expect((await json(await patch(mine.id, { parentId: mine.id }))).error).toBe('Un compte ne peut pas être son propre parent')
      expect((await json(await patch(mine.id, { parentId: otherYearParent.id }))).error).toBe(
        'Le compte parent doit appartenir au même exercice fiscal',
      )
      expect((await json(await patch(mine.id, { code: '41000', parentId: parent512.id }))).error).toBe(
        'Le code du compte enfant doit commencer par le code du parent (512)',
      )

      // A sub-account takes the nomenclature of its new parent
      const attached = await patch(mine.id, { parentId: parent512.id })
      expect(await json(attached)).toMatchObject({ parentId: parent512.id, isPCG: true })
      const detached = await patch(mine.id, { parentId: 'none' })
      expect(await json(detached)).toMatchObject({ parentId: null })
    })

    it('deletes an account with its sub-accounts', async () => {
      const root = await account('4011', 'Fournisseurs divers')
      const child = await account('40111', 'Fournisseur A', { parentId: root.id })
      await account('401111', 'Fournisseur A1', { parentId: child.id })
      const response = await call(r.account.DELETE, 'DELETE', `/api/accounts/${root.id}`, undefined, { id: root.id })
      expect(response.status).toBe(200)
      expect(await json(response)).toEqual({ success: true, message: 'Compte supprimé avec succès' })
      expect(await prisma.account.count({ where: { companyId: ids.company } })).toBe(0)
    })

    it('refuses to delete a PCG account, an account with entries or a tree holding one (409)', async () => {
      const pcg = await account('512', 'Banques', { isPCG: true })
      const del = (id: string) => call(r.account.DELETE, 'DELETE', `/api/accounts/${id}`, undefined, { id })

      const refused = await del(pcg.id)
      expect(refused.status).toBe(409)
      expect((await json(refused)).error).toBe('Impossible de supprimer un compte du PCG')

      const root = await account('4011', 'Fournisseurs divers')
      const child = await account('40111', 'Fournisseur A', { parentId: root.id })
      const grandChild = await account('401111', 'Fournisseur A1', { parentId: child.id })
      const sales = await account('706000', 'Ventes')
      await entryOn(sales.id, grandChild.id, '12.00', 'BR-1')

      const withLines = await del(grandChild.id)
      expect(withLines.status).toBe(409)
      expect((await json(withLines)).error).toBe('Le compte contient des écritures')

      const tree = await del(root.id)
      expect(tree.status).toBe(409)
      expect((await json(tree)).error).toBe(
        'Le compte enfant 40111 ne peut pas être supprimé : Le compte enfant 401111 ne peut pas être supprimé : Le compte contient des écritures',
      )

      const pcgChild = await account('4012', 'Autres')
      await account('40121', 'Sous-compte PCG', { parentId: pcgChild.id, isPCG: true })
      expect((await json(await del(pcgChild.id))).error).toBe('Le compte enfant 40121 est un compte du PCG et ne peut pas être supprimé')
      expect(await prisma.account.count({ where: { companyId: ids.company } })).toBe(7)
    })

    it('deletes the non PCG accounts of a chart, or lists those holding entries (409)', async () => {
      const pcg = await account('401', 'Fournisseurs', { isPCG: true })
      const a = await account('4011', 'Fournisseur A', { parentId: pcg.id })
      await account('40111', 'Fournisseur A1', { parentId: a.id })
      const b = await account('4012', 'Fournisseur B', { parentId: pcg.id })
      await account('4013', 'Autre exercice', { fiscalYearId: ids.fy2 })
      const sales = await account('706', 'Ventes', { isPCG: true })
      const entry = await entryOn(sales.id, b.id, '5.00', 'BR-1')

      const refused = await call(r.deleteNonPcg.POST, 'POST', '/api/accounts/delete-non-pcg', { companyId: ids.company, fiscalYearId: ids.fy })
      expect(refused.status).toBe(409)
      expect(await json(refused)).toEqual({
        error: 'Certains comptes contiennent des écritures et ne peuvent pas être supprimés',
        accountsWithEntries: ['4012 - Fournisseur B'],
      })
      expect(await prisma.account.count({ where: { companyId: ids.company } })).toBe(6)

      await prisma.accountingEntry.delete({ where: { id: entry.id } })
      const done = await call(r.deleteNonPcg.POST, 'POST', '/api/accounts/delete-non-pcg', { companyId: ids.company, fiscalYearId: ids.fy })
      expect(done.status).toBe(200)
      expect(await json(done)).toEqual({ deletedCount: 3, message: '3 comptes inconnus au PCG supprimés' })
      expect((await prisma.account.findMany({ where: { companyId: ids.company }, orderBy: { code: 'asc' } })).map((x) => x.code)).toEqual([
        '401',
        '4013',
        '706',
      ])

      const nothing = await call(r.deleteNonPcg.POST, 'POST', '/api/accounts/delete-non-pcg', { companyId: ids.company, fiscalYearId: ids.fy })
      expect(await json(nothing)).toEqual({ deletedCount: 0, message: 'Aucun compte inconnu au PCG à supprimer' })

      const foreign = await call(r.deleteNonPcg.POST, 'POST', '/api/accounts/delete-non-pcg', { companyId: ids.company, fiscalYearId: ids.otherFy })
      expect(foreign.status).toBe(400)
    })

    it('completes a chart with the PCG accounts, idempotently, and fixes parent links', async () => {
      const body = { companyId: ids.company, fiscalYearId: ids.fy }
      const first = await call(r.compliance.POST, 'POST', '/api/accounts/check-pcg-compliance', body)
      expect(first.status).toBe(200)
      const added = await json(first)
      expect(added.success).toBe(true)
      expect(added.addedCount).toBeGreaterThan(100)
      // The nomenclature lists a few numbers twice: each one is added once
      expect(added.addedCount).toBeLessThanOrEqual(added.missingCount as number)
      expect(added.message).toMatch(/^\d+ comptes? manquants? ajoutés?$/)
      const required = await prisma.account.findMany({ where: { companyId: ids.company, fiscalYearId: ids.fy } })
      // Only non-optional accounts: up to 4 digits outside class 8, plus the VAT accounts Kledg posts to.
      expect(required.every((a) => !isOptionalPcgAccount(a.code))).toBe(true)
      expect(required.some((a) => a.code === '44566')).toBe(true)

      // Break one link, then complete again: nothing added, one link fixed
      const a512 = required.find((a) => a.code === '512')!
      const a51 = required.find((a) => a.code === '51')!
      await prisma.account.update({ where: { id: a512.id }, data: { parentId: null } })
      const again = await json(await call(r.compliance.POST, 'POST', '/api/accounts/check-pcg-compliance', body))
      expect(again).toMatchObject({ addedCount: 0, missingCount: 0, fixedRelationsCount: 1, message: '1 rattachement au compte parent corrigé' })
      expect((await prisma.account.findUnique({ where: { id: a512.id } }))?.parentId).toBe(a51.id)

      const clean = await json(await call(r.compliance.POST, 'POST', '/api/accounts/check-pcg-compliance', body))
      expect(clean.message).toBe('Tous les comptes du PCG requis sont présents et correctement rattachés')

      const foreign = await call(r.compliance.POST, 'POST', '/api/accounts/check-pcg-compliance', { companyId: ids.company, fiscalYearId: ids.otherFy })
      expect(foreign.status).toBe(400)
      const badBody = await call(r.compliance.POST, 'POST', '/api/accounts/check-pcg-compliance', { ...body, includeOptionalAccounts: 'yes' })
      expect(badBody.status).toBe(400)
    }, 60_000)

    it('seeds the PCG in a fiscal year of the company only', async () => {
      const form = (fiscalYearId: string) => {
        const data = new FormData()
        data.set('companyId', ids.company)
        data.set('fiscalYearId', fiscalYearId)
        return data
      }
      const seeded = await call(r.seedPcg.POST, 'POST', '/api/accounts/seed-pcg', form(ids.fy))
      expect(seeded.status).toBe(200)
      expect(await json(seeded)).toEqual({ success: true })
      expect(await prisma.account.count({ where: { companyId: ids.company, fiscalYearId: ids.fy, isPCG: true } })).toBeGreaterThan(100)

      expect((await call(r.seedPcg.POST, 'POST', '/api/accounts/seed-pcg', form(ids.otherFy))).status).toBe(404)
      const noYear = new FormData()
      noYear.set('companyId', ids.company)
      expect((await call(r.seedPcg.POST, 'POST', '/api/accounts/seed-pcg', noYear)).status).toBe(400)
    }, 60_000)

    it('returns the ledger of an account with totals summed in cents', async () => {
      const bank = await account('512000', 'Banque')
      const sales = await account('706000', 'Ventes')
      await entryOn(bank.id, sales.id, '0.10', 'BR-1', '2026-01-05')
      await entryOn(bank.id, sales.id, '0.20', 'BR-2', '2026-01-06')
      await entryOn(sales.id, bank.id, '0.05', 'BR-3', '2026-01-07')

      const response = await call(r.accountEntries.GET, 'GET', `/api/accounts/${bank.id}/entries?fiscalYearId=${ids.fy}`, undefined, { id: bank.id })
      expect(response.status).toBe(200)
      const ledger = (await response.json()) as {
        account: unknown
        entryLines: Array<{ debit: number; credit: number; accountingEntry: { entryNumber: string; journal: unknown } }>
        totals: unknown
      }
      expect(ledger.account).toEqual({ id: bank.id, code: '512000', label: 'Banque', isPCG: false })
      expect(ledger.entryLines.map((l) => l.accountingEntry.entryNumber)).toEqual(['BR-1', 'BR-2', 'BR-3'])
      expect(ledger.entryLines[0]).toMatchObject({ debit: 0.1, credit: 0, accountingEntry: { journal: { code: 'OD', label: 'Opérations diverses' } } })
      // 0.1 + 0.2 in floats is 0.30000000000000004
      expect(ledger.totals).toEqual({ debit: 0.3, credit: 0.05, balance: 0.25 })

      const otherYear = await call(r.accountEntries.GET, 'GET', `/api/accounts/${bank.id}/entries?fiscalYearId=${ids.fy2}`, undefined, { id: bank.id })
      expect(((await otherYear.json()) as { entryLines: unknown[] }).entryLines).toEqual([])
    })

    it('returns the balance evolution of an account of the company only', async () => {
      const bank = await account('512000', 'Banque')
      const ok = await call(r.balanceEvolution.GET, 'GET', `/api/accounts/${bank.id}/balance-evolution`, undefined, { id: bank.id })
      expect(ok.status).toBe(200)
      expect(Array.isArray(await ok.json())).toBe(true)
      const foreign = await prisma.account.create({ data: { companyId: ids.other, fiscalYearId: ids.otherFy, code: '512000', label: 'Banque' } })
      expect((await call(r.balanceEvolution.GET, 'GET', `/api/accounts/${foreign.id}/balance-evolution`, undefined, { id: foreign.id })).status).toBe(404)
    })
  })
})
