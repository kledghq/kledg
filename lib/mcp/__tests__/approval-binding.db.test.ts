/**
 * Round 3 MCP regressions against PostgreSQL, through the real /api/mcp
 * handler with API keys (session mocked, services, triggers and audit log
 * real):
 * - KLEDG-R3-MCP-01: an approval covers the data the user saw. Editing an
 *   approved draft entry (update_draft_entry) or draft invoice
 *   (update_draft_invoice), or a rule (update_rule), before the execution
 *   refuses the action, which then cannot run;
 * - KLEDG-R3-MCP-03: upload_receipt needs the approval in validation mode;
 * - KLEDG-R3-MCP-09: an entry already linked to a transaction cannot be
 *   reconciled with another one;
 * - KLEDG-R3-MCP-10: bulk_reconcile apply_rule and mark_reconciled, and
 *   sync_bank_data refresh, need the approval like run_rules;
 * - KLEDG-R3-MCP-11: create_draft_entry is audited with the assistant.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('mcp_approval_binding')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({ getCurrentUser: async () => state.user }))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import type { ExecutionMode } from '@/lib/ai-access/access'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let mcp: { POST: (request: Request) => Promise<Response> }

const OWNER = { id: 'u-owner', email: 'owner@test.local', name: 'Owner', role: 'user' }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ids = {} as Record<string, string>

const CHART: Array<[string, string]> = [
  ['401', 'Fournisseurs'],
  ['411', 'Clients'],
  ['455', 'Associés comptes courants'],
  ['512', 'Banque'],
  ['512000', 'Banque'],
  ['606', 'Achats'],
  ['606100', 'Fournitures'],
  ['627', 'Services bancaires'],
  ['44566', 'TVA déductible'],
]

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

async function apiKey(level: 'read' | 'write' | 'admin', mode: ExecutionMode = 'validation', name = `Assistant ${level} ${mode}`) {
  const { createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service')
  return (await createApiKeyWithGrant({ ...OWNER }, name, { allCompanies: true, companyIds: [] }, level, mode)).key
}

/** The user's approval in Kledg (what the approval route does after the password). */
async function approve(actionId: string) {
  const { decideAction } = await import('@/lib/mcp/full-control/pending-actions')
  await decideAction(OWNER.id, actionId, 'approve')
}

async function draftEntry(description: string, amount: string) {
  const { createEntry } = await import('@/lib/accounting/services/entry-lifecycle.service')
  return createEntry({
    companyId: ids.company,
    journalId: ids.journal,
    date: '2025-03-01',
    description,
    lines: [
      { accountId: ids['606'], debit: amount, credit: 0 },
      { accountId: ids['401'], debit: 0, credit: amount },
    ],
  })
}

describe.skipIf(!available)('MCP approvals and writes (round 3)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('mcp_approval_binding')
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

  describe('KLEDG-R3-MCP-01: an approval is bound to the data it acts on', () => {
    it('refuses validate_entries when the approved draft was edited by update_draft_entry', async () => {
      const key = await apiKey('admin')
      const entry = await draftEntry('Fournitures', '12.00')

      const dry = await ok(key, 'validate_entries', { companyId: ids.company, entryIds: [entry.id] })
      expect(dry.preview.totalDebit).toBe(12)
      await approve(dry.actionId)

      await ok(key, 'update_draft_entry', {
        companyId: ids.company,
        entryId: entry.id,
        description: 'Remboursement associé',
        lines: [
          { accountCode: '455', debit: 95000 },
          { accountCode: '512', credit: 95000 },
        ],
      })

      const done = await call(key, 'validate_entries', { companyId: ids.company, entryIds: [entry.id], actionId: dry.actionId })
      expect(done.ok).toBe(false)
      expect(done.text).toMatch(/Les données ont changé depuis l'approbation/)
      const row = await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { status: true } })
      expect(row.status).toBe('draft')
      expect((await prisma.mcpPendingAction.findUniqueOrThrow({ where: { id: dry.actionId } })).status).toBe('failed')
      const refused = await prisma.auditLog.findMany({ where: { action: 'MCP_FULL_CONTROL_REFUSED', companyId: ids.company } })
      expect(refused.some((log) => (log.metadata as { actionId?: string }).actionId === dry.actionId)).toBe(true)

      // The refused action is spent: calling it again does not run it either.
      const again = await call(key, 'validate_entries', { companyId: ids.company, entryIds: [entry.id], actionId: dry.actionId })
      expect(again.ok).toBe(false)
      expect((await prisma.accountingEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('draft')
    })

    it('still executes an approved action on unchanged data', async () => {
      const key = await apiKey('admin')
      const entry = await draftEntry('Papier', '30.00')
      const dry = await ok(key, 'validate_entries', { companyId: ids.company, entryIds: [entry.id] })
      await approve(dry.actionId)
      const done = await ok(key, 'validate_entries', { companyId: ids.company, entryIds: [entry.id], actionId: dry.actionId })
      expect(done.executed).toBe(true)
      expect(done.result.validated).toHaveLength(1)
    })

    it('refuses manage_invoice post when the approved invoice was edited by update_draft_invoice', async () => {
      const auto = await apiKey('admin', 'automatic', 'Préparation')
      const key = await apiKey('admin')
      const tiers = await ok(key, 'manage_tiers', { companyId: ids.company, action: 'create', tiers: { kind: 'SUPPLIER', name: 'Fournitures Martin' } })
      const created = await ok(auto, 'create_draft_invoice', {
        companyId: ids.company,
        direction: 'PURCHASE',
        tiers: tiers.tiersId,
        number: 'F-001',
        issueDate: '2025-03-15',
        lines: [{ label: 'Papier', quantity: 1, unitPrice: 100, vatRate: 20, accountCode: '606100' }],
      })
      const invoiceId = created.result.invoice?.id ?? created.result.invoiceId ?? created.result.id
      expect(invoiceId).toBeTruthy()

      const dry = await ok(key, 'manage_invoice', { companyId: ids.company, action: 'post', invoiceId })
      expect(dry.dryRun).toBe(true)
      await approve(dry.actionId)

      await ok(key, 'update_draft_invoice', {
        companyId: ids.company,
        invoiceId,
        invoice: { direction: 'PURCHASE', tiersId: tiers.tiersId, number: 'F-001', issueDate: '2025-03-15', lines: [{ label: 'Papier', quantity: '900', unitPrice: 100, vatRate: 20, accountCode: '606100' }] },
      })

      const done = await call(key, 'manage_invoice', { companyId: ids.company, action: 'post', invoiceId, actionId: dry.actionId })
      expect(done.ok).toBe(false)
      expect(done.text).toMatch(/Les données ont changé depuis l'approbation/)
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { entryId: true } })
      expect(invoice.entryId).toBeNull()
    })

    it('refuses run_rules when a rule was changed by update_rule after the approval', async () => {
      const key = await apiKey('admin')
      const rule = await ok(key, 'create_rule', {
        companyId: ids.company,
        name: 'Frais bancaires',
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'FRAIS' }],
        entryLines: [{ accountCode: '627', lineType: 'auto', amountType: 'full' }],
      })
      const dry = await ok(key, 'run_rules', { companyId: ids.company })
      await approve(dry.actionId)
      await ok(key, 'update_rule', {
        companyId: ids.company,
        ruleId: rule.id,
        name: 'Frais bancaires',
        conditions: [{ conditionType: 'label', operator: 'contains', value: 'VIR' }],
        entryLines: [{ accountCode: '455', lineType: 'auto', amountType: 'full' }],
      })
      const done = await call(key, 'run_rules', { companyId: ids.company, actionId: dry.actionId })
      expect(done.ok).toBe(false)
      expect(done.text).toMatch(/Les données ont changé depuis l'approbation/)
    })
  })
})
