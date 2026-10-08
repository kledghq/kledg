/**
 * KLEDG-R3-MCP-01 for the high-impact tools whose services take no lock of
 * their own (lib/approved-state/ambient.ts), against PostgreSQL through the
 * real /api/mcp handler with API keys in validation mode:
 * - an approved action runs in one transaction that starts by locking and
 *   checking its targets: an edit of an approved row committed while the
 *   execution waits on its lock refuses the action, nothing is written and
 *   the approval stays unused (delete_tiers, letter_entry_lines,
 *   close_fiscal_year);
 * - a parent row locked only to serialize (the company, a bank account)
 *   makes a concurrent edit and the action run one after the other, and the
 *   action still runs (import_statement, update_company_settings);
 * - the single transaction keeps the services' semantics: a query error the
 *   service catches does not abort it, a failing inner $transaction rolls
 *   back to its savepoint, anything thrown rolls everything back.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_approval_atomic')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let mcp: { POST: (request: Request) => Promise<Response> }

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ids = {} as Record<string, string>
const STATE_CHANGED = /Les données ont changé depuis l'approbation/

const CHART: Array<[string, string]> = [
  ['401', 'Fournisseurs'],
  ['411', 'Clients'],
  ['512000', 'Banque'],
  ['606', 'Achats'],
  ['627', 'Services bancaires'],
  ['706', 'Prestations de services'],
]

type Tx = Parameters<Parameters<typeof import('@/lib/prisma').prisma.$transaction>[0]>[0]

async function call(key: string, name: string, args: Record<string, unknown>) {
  const response = await mcp.POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  )
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(raw) as { result?: { content?: Array<{ text: string }>; isError?: boolean }; error?: { message: string } }
  const out = body.result?.content?.[0]?.text ?? body.error?.message ?? ''
  const ok = !body.result?.isError && !body.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok, text: out, data: (ok ? JSON.parse(out) : {}) as Record<string, any> }
}

async function ok(key: string, name: string, args: Record<string, unknown>) {
  const result = await call(key, name, args)
  expect(result.ok, `${name}: ${result.text}`).toBe(true)
  return result.data
}

async function apiKey(name: string) {
  const { createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service')
  return (await createApiKeyWithGrant({ ...OWNER }, name, { allCompanies: true, companyIds: [] }, 'admin', 'validation')).key
}

/** Dry run, then the user's approval in Kledg; returns the action id. */
async function prepared(key: string, name: string, args: Record<string, unknown>): Promise<string> {
  const dry = await ok(key, name, args)
  expect(dry.dryRun).toBe(true)
  const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
  await decideAction(OWNER.id, dry.actionId, 'approve')
  return dry.actionId
}

const statusOf = async (actionId: string) => (await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: actionId } })).status

/**
 * Runs `edit` in a transaction left open until the approved execution waits
 * on a row lock, then commits it: the edit lands after the check done before
 * the execution, while the action's transaction is about to read the rows.
 */
async function editDuringExecution(edit: (tx: Tx) => Promise<unknown>, execute: () => Promise<Awaited<ReturnType<typeof call>>>) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let edited!: () => void
  const editDone = new Promise<void>((resolve) => (edited = resolve))
  const editing = prisma.$transaction(
    async (tx) => {
      await edit(tx)
      edited()
      await gate
    },
    { timeout: 30_000 },
  )
  await editDone
  const execution = execute()
  let waiting = 0
  for (let i = 0; i < 200 && waiting === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`
    waiting = Number(rows[0]?.n ?? 0)
  }
  release()
  await editing
  return { result: await execution, waited: waiting > 0 }
}

async function entry(description: string, lines: Array<[string, string, string]>, status: 'draft' | 'validated' = 'draft', date = '2025-03-01') {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  return createEntry({
    companyId: ids.company,
    journalId: ids.journal,
    date,
    description,
    status,
    lines: lines.map(([code, debit, credit]) => ({ accountId: ids[code], debit, credit })),
  })
}

describe.skipIf(!available)('approved actions in one transaction (KLEDG-R3-MCP-01)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('mcp_approval_atomic')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as typeof mcp
    await prisma.user.create({ data: OWNER })
    const company = await prisma.company.create({ data: { name: 'A', slug: 'a', siren: '123456782', legalType: 'SAS', closingDay: 31, closingMonth: 12 } })
    await prisma.organization.create({ data: { id: 'org-a', name: 'A', slug: 'org-a', createdAt: new Date(), companyId: company.id } })
    await prisma.member.create({ data: { id: 'm-a', userId: OWNER.id, organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31'), closingDay: 31, closingMonth: 12 },
    })
    for (const [code, label] of CHART) {
      ids[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })).id
    }
    for (const code of ['BQ', 'AC', 'VE']) await prisma.journal.create({ data: { companyId: company.id, code, label: code } })
    ids.journal = (await prisma.journal.create({ data: { companyId: company.id, code: 'OD', label: 'OD' } })).id
    ids.company = company.id
    ids.fy = fy.id
    state.user = OWNER
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('an edit of an approved row during the execution refuses the action', () => {
    it('delete_tiers: the tiers renamed while the deletion waits on its lock stays, approval unused', async () => {
      const key = await apiKey('Tiers')
      const tiers = await prisma.tiers.create({ data: { companyId: ids.company, kind: 'SUPPLIER', name: 'Papeterie Leroy', auxiliaryAccountNumber: 'AUX001' } })
      const actionId = await prepared(key, 'delete_tiers', { companyId: ids.company, tiersId: tiers.id })
      const { result, waited } = await editDuringExecution(
        (tx) => tx.tiers.update({ where: { id: tiers.id }, data: { name: 'Papeterie Leroy et Fils' } }),
        () => call(key, 'delete_tiers', { companyId: ids.company, tiersId: tiers.id, actionId }),
      )
      expect(waited).toBe(true)
      expect(result.ok).toBe(false)
      expect(result.text).toMatch(STATE_CHANGED)
      expect(await prisma.tiers.count({ where: { id: tiers.id } })).toBe(1)
      expect(await statusOf(actionId)).toBe('approved')
    })

    it('letter_entry_lines: a line lettered elsewhere while the lettering waits stays as it is', async () => {
      const key = await apiKey('Lettrage')
      const invoice = await entry('Facture Martin', [['606', '100.00', '0'], ['401', '0', '100.00']], 'validated')
      const payment = await entry('Paiement Martin', [['401', '100.00', '0'], ['512000', '0', '100.00']], 'validated', '2025-03-05')
      const lineIds = [...invoice.lines, ...payment.lines].filter((l) => l.accountId === ids['401']).map((l) => l.id)
      const args = { companyId: ids.company, accountCode: '401', fiscalYearId: ids.fy, lineIds }
      const actionId = await prepared(key, 'letter_entry_lines', args)
      const { result, waited } = await editDuringExecution(
        (tx) => tx.entryLine.update({ where: { id: lineIds[0] }, data: { letteringCode: 'ZZ' } }),
        () => call(key, 'letter_entry_lines', { ...args, actionId }),
      )
      expect(waited).toBe(true)
      expect(result.ok).toBe(false)
      expect(result.text).toMatch(STATE_CHANGED)
      const lines = await prisma.entryLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, letteringCode: true } })
      expect(lines.find((l) => l.id === lineIds[1])?.letteringCode).toBeNull()
      expect(await statusOf(actionId)).toBe('approved')
    })

    it('close_fiscal_year: an entry of the year edited while the closing waits on the year’s entries refuses it', async () => {
      const key = await apiKey('Clôture')
      const draftEntry = await entry('Brouillon', [['627', '10.00', '0'], ['512000', '0', '10.00']])
      const actionId = await prepared(key, 'close_fiscal_year', { companyId: ids.company, fiscalYearId: ids.fy })
      const { result, waited } = await editDuringExecution(
        (tx) => tx.accountingEntry.update({ where: { id: draftEntry.id }, data: { description: 'Brouillon modifié' } }),
        () => call(key, 'close_fiscal_year', { companyId: ids.company, fiscalYearId: ids.fy, actionId }),
      )
      expect(waited).toBe(true)
      expect(result.ok).toBe(false)
      expect(result.text).toMatch(STATE_CHANGED)
      expect((await prisma.fiscalYear.findUniqueOrThrow({ where: { id: ids.fy } })).isClosed).toBe(false)
      expect(await statusOf(actionId)).toBe('approved')
      await prisma.accountingEntry.delete({ where: { id: draftEntry.id } })
    })
  })

  describe('a parent row locked to serialize: the edit and the action run one after the other', () => {
    it('import_statement waits for an edit of its bank account, then imports', async () => {
      const key = await apiKey('Relevés')
      const connection = await prisma.bankConnection.create({ data: { companyId: ids.company, provider: 'MANUAL' } })
      const bankAccount = await prisma.bankAccount.create({ data: { bankConnectionId: connection.id, externalAccountId: 'acc-imp', name: 'Compte courant', ledgerAccountCode: '512000' } })
      const csv = Buffer.from(['Date;Libellé;Montant', '15/03/2025;PRLV FOURNITURES MARTIN;-120,00', '20/03/2025;VIR CLIENT DUPONT;1200,00'].join('\n')).toString('base64')
      const args = { companyId: ids.company, bankAccountId: bankAccount.id, fileName: 'releve.csv', contentBase64: csv }
      const actionId = await prepared(key, 'import_statement', args)
      const { result, waited } = await editDuringExecution(
        (tx) => tx.bankAccount.update({ where: { id: bankAccount.id }, data: { name: 'Compte principal' } }),
        () => call(key, 'import_statement', { ...args, actionId }),
      )
      expect(waited).toBe(true)
      expect(result.ok, result.text).toBe(true)
      expect(result.data.result.created).toBe(2)
      expect(await prisma.bankTransaction.count({ where: { bankAccountId: bankAccount.id } })).toBe(2)
      expect(await statusOf(actionId)).toBe('executed')
    })

    it('update_company_settings waits for another edit of the company, then applies', async () => {
      const key = await apiKey('Paramètres')
      const args = { companyId: ids.company, section: 'company', company: { name: 'Société Alpha' } }
      const actionId = await prepared(key, 'update_company_settings', args)
      const { result, waited } = await editDuringExecution(
        (tx) => tx.company.update({ where: { id: ids.company }, data: { phone: '0102030405' } }),
        () => call(key, 'update_company_settings', { ...args, actionId }),
      )
      expect(waited).toBe(true)
      expect(result.ok, result.text).toBe(true)
      expect(await prisma.company.findUniqueOrThrow({ where: { id: ids.company }, select: { name: true, phone: true } })).toEqual({ name: 'Société Alpha', phone: '0102030405' })
    })
  })

  describe('the single transaction keeps the services’ semantics', () => {
    const run = async <T>(fn: () => Promise<T>) => {
      const { runInAmbientTransaction } = await import('@/lib/approved-state/ambient')
      return runInAmbientTransaction(prisma, async () => {}, fn)
    }

    it('rolls everything back when the action throws', async () => {
      await expect(
        run(async () => {
          await prisma.tiers.create({ data: { companyId: ids.company, kind: 'CUSTOMER', name: 'Annulé', auxiliaryAccountNumber: 'AUX002' } })
          throw new Error('failure after a write')
        }),
      ).rejects.toThrow('failure after a write')
      expect(await prisma.tiers.count({ where: { companyId: ids.company, name: 'Annulé' } })).toBe(0)
    })

    it('a query error caught by the service does not abort the transaction', async () => {
      await run(async () => {
        await expect(prisma.$queryRawUnsafe('SELECT 1 / 0')).rejects.toThrow()
        await prisma.tiers.create({ data: { companyId: ids.company, kind: 'CUSTOMER', name: 'Après erreur', auxiliaryAccountNumber: 'AUX003' } })
      })
      expect(await prisma.tiers.count({ where: { companyId: ids.company, name: 'Après erreur' } })).toBe(1)
    })

    it('a failing inner $transaction rolls back to its savepoint only; concurrent queries are serialized', async () => {
      await run(async () => {
        await prisma.tiers.create({ data: { companyId: ids.company, kind: 'CUSTOMER', name: 'Avant', auxiliaryAccountNumber: 'AUX004' } })
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.tiers.create({ data: { companyId: ids.company, kind: 'CUSTOMER', name: 'Interne', auxiliaryAccountNumber: 'AUX005' } })
            throw new Error('inner failure')
          }),
        ).rejects.toThrow('inner failure')
        const [a, b] = await Promise.all([prisma.tiers.count({ where: { companyId: ids.company } }), prisma.company.count()])
        expect(a).toBeGreaterThan(0)
        expect(b).toBe(1)
        await prisma.$transaction([prisma.tiers.create({ data: { companyId: ids.company, kind: 'CUSTOMER', name: 'Lot', auxiliaryAccountNumber: 'AUX006' } })])
      })
      const names = (await prisma.tiers.findMany({ where: { companyId: ids.company, name: { in: ['Avant', 'Interne', 'Lot'] } }, select: { name: true } })).map((t) => t.name)
      expect(names.sort()).toEqual(['Avant', 'Lot'])
    })
  })
})
