/**
 * The unique reconciliation match (lib/reconciliation/unique-match.ts) and
 * the "Rapprocher" button of list_bank_transactions, against PostgreSQL,
 * through the real /api/mcp handler with API keys (session mocked):
 * - an existing entry line on the bank account's ledger account, same
 *   amount to the cent, within a day, entry not linked: a match, which wins
 *   over a rule;
 * - two candidate lines, a line that fits two transactions, a line of an
 *   entry already linked, a line on another account: no match;
 * - exactly one matching rule: a match with the rule's lines; two rules:
 *   no match;
 * - the button is a plain call of reconcile_transaction: a direct write in
 *   validation mode (no pending action), checked by the server; no button
 *   for a read connection nor for a role without the reconcile right.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('unique_match')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { AccessLevel, ExecutionMode } from '@/lib/ai-access/access'
import { VIEW_SCHEMAS } from '@/lib/mcp/views/schemas'

const available = await testDatabaseAvailable()

type Handler = (request: Request) => Promise<Response>

let prisma: typeof import('@/lib/prisma').prisma
let mcp: Record<'POST', Handler>
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant
let uniqueReconciliationMatches: typeof import('@/lib/reconciliation/unique-match').uniqueReconciliationMatches

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const CHART: Array<[string, string]> = [
  ['411', 'Clients'],
  ['44566', 'TVA sur autres biens et services'],
  ['512', 'Banques'],
  ['512000', 'Banque'],
  ['606100', 'Fournitures non stockables'],
  ['616000', 'Assurances'],
]
const STATEMENT = [
  'Date;Libellé;Montant',
  '20/03/2025;VIR CLIENT DUPONT;1200,00',
  '15/03/2025;PRLV FOURNITURES MARTIN;-120,00',
  '16/03/2025;FOURNITURES BIS;-60,00',
  '17/03/2025;FOURNITURES PAPIER;-40,00',
  '10/04/2025;PRLV ASSURANCE;-300,00',
  '05/05/2025;CB RESTAURANT A;-75,00',
  '06/05/2025;CB RESTAURANT B;-75,00',
  '02/06/2025;PRLV TELEPHONE;-50,00',
  '01/06/2025;PRLV INTERNET;-50,00',
  '20/07/2025;VIR DIVERS;500,00',
].join('\n')

const ids = {} as Record<string, string>
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

type RpcResult = { content?: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean }

async function rpc(key: string, method: string, params: unknown = {}) {
  const response = await mcp.POST(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  expect(response.status).toBe(200)
  const text = await response.text()
  const raw = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: '))?.slice(6) ?? 'null')
  const body = JSON.parse(raw) as { result?: RpcResult; error?: { message: string } }
  expect(body.error, JSON.stringify(body.error)).toBeUndefined()
  return body.result!
}

async function call(key: string, name: string, args: Record<string, unknown>) {
  const result = await rpc(key, 'tools/call', { name, arguments: { companyId: ids.company, ...args } })
  expect(result.isError, `${name}: ${result.content?.[0]?.text}`).toBeFalsy()
  return result
}

async function apiKey(level: AccessLevel, mode: ExecutionMode = 'validation'): Promise<string> {
  return (await createApiKeyWithGrant({ ...OWNER }, `Clé ${level} ${mode}`, { allCompanies: true, companyIds: [] }, level, mode)).key
}

async function entry(date: string, description: string, status: 'draft' | 'validated', lines: Array<[string, number, number]>) {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  const journal = await prisma.journal.findFirstOrThrow({ where: { companyId: ids.company, code: 'OD' } })
  return createEntry({
    companyId: ids.company,
    journalId: journal.id,
    date,
    description,
    status,
    lines: lines.map(([code, debit, credit]) => ({ accountId: ids[code], debit, credit })),
  })
}

const rule = (name: string, contains: string) => ({
  name,
  conditions: [{ conditionType: 'label', operator: 'contains', value: contains }],
  entryLines: [{ accountCode: '606100', lineType: 'auto', amountType: 'full' }],
})

type ListItem = {
  id: string
  cells: Record<string, unknown>
  match?: { kind: string; entryId: string | null; lineId: string | null; ruleId: string | null; label: string; amount: number; date: string }
  actions: Array<{ kind: string; label: string; tool?: string; arguments?: Record<string, unknown>; highImpact?: boolean }>
}

async function list(key: string) {
  const result = await call(key, 'list_bank_transactions', { limit: 200 })
  const parsed = VIEW_SCHEMAS.actions.safeParse(result.structuredContent)
  expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true)
  const items = (result.structuredContent as { items: ListItem[] }).items
  return (label: string) => items.find((i) => i.cells.label === label)!
}

describe.skipIf(!available)('unique reconciliation match and the Rapprocher button', () => {
  beforeAll(async () => {
    await prepareTestDatabase('unique_match')
    ;({ prisma } = await import('@/lib/prisma'))
    mcp = (await import('@/app/api/mcp/route')) as unknown as Record<'POST', Handler>
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
    ;({ uniqueReconciliationMatches } = await import('@/lib/reconciliation/unique-match'))

    await prisma.user.create({ data: { id: OWNER.id, email: OWNER.email, name: OWNER.name, role: OWNER.role } })
    const company = await prisma.company.create({
      data: { name: 'Société A', slug: 'societe-a', siren: '123456782', legalType: 'SAS', closingDay: 31, closingMonth: 12, vatRegime: 'normal', corporateTaxRegime: 'simplified' },
    })
    ids.company = company.id
    await prisma.organization.create({ data: { id: 'org-a', name: company.name, slug: 'org-a', createdAt: new Date(), companyId: company.id } })
    await prisma.member.create({ data: { id: 'm-a-owner', userId: OWNER.id, organizationId: 'org-a', role: 'companyAdmin', createdAt: new Date() } })
    const fy = await prisma.fiscalYear.create({
      data: { companyId: company.id, year: 2025, startDate: day('2025-01-01'), endDate: day('2025-12-31'), closingDay: 31, closingMonth: 12 },
    })
    for (const [code, label] of CHART) {
      ids[code] = (await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code, label, isPCG: true } })).id
    }
    for (const code of ['BQ', 'OD']) await prisma.journal.create({ data: { companyId: company.id, code, label: code } })

    const admin = await apiKey('admin', 'automatic')
    const account = JSON.parse((await call(admin, 'create_bank_account', { name: 'Compte courant', ledgerAccountCode: '512000' })).content![0].text)
    await call(admin, 'import_statement', { bankAccountId: account.id, fileName: 'releve.csv', contentBase64: Buffer.from(STATEMENT).toString('base64') })
    const transactions = await prisma.bankTransaction.findMany({ select: { id: true, label: true } })
    for (const t of transactions) ids[t.label!] = t.id

    ids.dupont = (await entry('2025-03-21', 'Règlement Dupont', 'draft', [['512000', 1200, 0], ['411', 0, 1200]])).id
    ids.papier = (await entry('2025-03-17', 'Papier', 'validated', [['606100', 40, 0], ['512000', 0, 40]])).id
    await entry('2025-04-10', 'Assurance avril', 'validated', [['616000', 300, 0], ['512000', 0, 300]])
    await entry('2025-04-11', 'Assurance avril bis', 'validated', [['616000', 300, 0], ['512000', 0, 300]])
    await entry('2025-05-05', 'Restaurant', 'validated', [['606100', 75, 0], ['512000', 0, 75]])
    ids.internet = (await entry('2025-06-01', 'Internet', 'validated', [['606100', 50, 0], ['512000', 0, 50]])).id
    await entry('2025-07-20', 'Divers sur 512', 'validated', [['512', 500, 0], ['411', 0, 500]])
    await call(admin, 'reconcile_transaction', { transactionId: ids['PRLV INTERNET'], entryId: ids.internet })
    ids.rule = JSON.parse((await call(admin, 'create_rule', rule('Fournitures', 'FOURNITURES'))).content![0].text).id
    await call(admin, 'create_rule', rule('Bis', 'BIS'))
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('finds only the unambiguous matches', async () => {
    const matches = await uniqueReconciliationMatches(ids.company, Object.values(ids))
    const line = await prisma.entryLine.findFirstOrThrow({ where: { accountingEntryId: ids.dupont, accountId: ids['512000'] } })
    expect(matches.get(ids['VIR CLIENT DUPONT'])).toMatchObject({
      kind: 'entry',
      entryId: ids.dupont,
      lineId: line.id,
      ruleId: null,
      amount: 1200,
      date: '2025-03-21',
      arguments: { transactionId: ids['VIR CLIENT DUPONT'], entryId: ids.dupont },
    })
    expect(matches.get(ids['VIR CLIENT DUPONT'])!.label).toContain('brouillon')
    // An existing entry wins over a matching rule
    expect(matches.get(ids['FOURNITURES PAPIER'])).toMatchObject({ kind: 'entry', entryId: ids.papier, amount: -40 })
    expect(matches.get(ids['PRLV FOURNITURES MARTIN'])).toMatchObject({
      kind: 'rule',
      ruleId: ids.rule,
      entryId: null,
      amount: -120,
      arguments: { transactionId: ids['PRLV FOURNITURES MARTIN'], journalCode: 'BQ', date: '2025-03-15', lines: [{ accountCode: '606100', debit: 120 }] },
    })
    // Two candidate entries; one entry for two transactions; an entry already linked; a line on 512 (not the ledger account); two rules
    for (const label of ['PRLV ASSURANCE', 'CB RESTAURANT A', 'CB RESTAURANT B', 'PRLV TELEPHONE', 'VIR DIVERS', 'FOURNITURES BIS', 'PRLV INTERNET']) {
      expect(matches.has(ids[label]), label).toBe(false)
    }
    expect(matches.size).toBe(3)
    // Another company sees nothing
    expect((await uniqueReconciliationMatches('other-company', Object.values(ids))).size).toBe(0)
  })

  it('gives no button to a read connection nor to a role without the reconcile right', async () => {
    const read = await list(await apiKey('read'))
    expect(read('VIR CLIENT DUPONT').match).toBeUndefined()
    expect(read('VIR CLIENT DUPONT').actions.map((a) => a.label)).toEqual(['Proposer une écriture'])

    await prisma.member.update({ where: { id: 'm-a-owner' }, data: { role: 'viewer' } })
    try {
      const viewer = await list(await apiKey('admin', 'automatic'))
      expect(viewer('VIR CLIENT DUPONT').match).toBeUndefined()
      expect(viewer('VIR CLIENT DUPONT').actions.some((a) => a.label === 'Rapprocher')).toBe(false)
    } finally {
      await prisma.member.update({ where: { id: 'm-a-owner' }, data: { role: 'companyAdmin' } })
    }
  })

  it('reconciles through the button in validation mode: a direct call, checked by the server, no pending action', async () => {
    const key = await apiKey('admin', 'validation')
    const item = await list(key)
    const dupont = item('VIR CLIENT DUPONT')
    expect(dupont.match).toMatchObject({ kind: 'entry', entryId: ids.dupont })
    const [reconcile] = dupont.actions
    expect(reconcile).toMatchObject({ kind: 'tool', label: 'Rapprocher', tool: 'reconcile_transaction', highImpact: false })
    expect(dupont.actions.some((a) => a.label === 'Proposer une écriture')).toBe(false)
    expect(item('PRLV ASSURANCE').actions.map((a) => a.label)).toEqual(['Proposer une écriture', 'Pointer sans écriture'])

    const pendingBefore = await prisma.mcpPendingAction.count()
    const result = JSON.parse((await rpc(key, 'tools/call', { name: reconcile.tool, arguments: reconcile.arguments })).content![0].text)
    expect(result).toMatchObject({ transactionId: ids['VIR CLIENT DUPONT'], reconciled: true, entryId: ids.dupont })
    expect(await prisma.mcpPendingAction.count()).toBe(pendingBefore)
    expect(await prisma.bankTransaction.findUniqueOrThrow({ where: { id: ids['VIR CLIENT DUPONT'] } })).toMatchObject({ reconciled: true, reconciledWith: ids.dupont })

    // The rule's button creates the draft entry with the rule's lines
    const [byRule] = item('PRLV FOURNITURES MARTIN').actions
    const created = JSON.parse((await rpc(key, 'tools/call', { name: byRule.tool, arguments: byRule.arguments })).content![0].text)
    expect(created).toMatchObject({ reconciled: true, entryStatus: 'draft' })
    const lines = await prisma.entryLine.findMany({ where: { accountingEntryId: created.entryId }, select: { debit: true, credit: true, account: { select: { code: true } } } })
    expect(lines.map((l) => [l.account.code, Number(l.debit), Number(l.credit)]).sort()).toEqual([['512000', 0, 120], ['606100', 120, 0]])

    // A second click on a stale view is refused by the server
    const again = await rpc(key, 'tools/call', { name: reconcile.tool, arguments: reconcile.arguments })
    expect(again.isError).toBe(true)

    // Fresh list: reconciled transactions are gone, their matches too
    const after = (await call(key, 'list_bank_transactions', { limit: 200 })).structuredContent as { items: ListItem[] }
    expect(after.items.some((i) => i.id === ids['VIR CLIENT DUPONT'])).toBe(false)
  })
})
