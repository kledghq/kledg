/**
 * Every MCP tool a request of "Proposer avec l'IA" names exists on the
 * server (lib/mcp/tools.ts): the read tools at every level, the draft and
 * full control tools at theirs. A renamed tool fails here, not in the
 * user's assistant.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { registerKledgTools } from '@/lib/mcp/tools'
import type { McpAccess } from '@/lib/mcp/company-access'
import { buildAiPrompt, type AiPromptTarget } from '../prompts'

function toolNames(level: { canWrite: boolean; canAdmin: boolean }): Set<string> {
  const names = new Set<string>()
  const access: McpAccess = { user: { id: 'u1', email: 'a@b.c', name: null, role: 'user' }, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation', ...level }
  registerKledgTools({ registerTool: (name: string) => names.add(name) } as never, access)
  return names
}

const TARGETS: AiPromptTarget[] = [
  { kind: 'bank_transaction', id: 'tx_1', date: '2026-09-29', label: 'FREE', amountCents: -4_799 },
  { kind: 'draft_entry', id: 'ent_7', date: '2026-09-30', label: 'Loyer', journalCode: 'OD' },
  { kind: 'invoice', id: 'inv_3', direction: 'SALE', number: 'F1', date: '2026-09-15', tiersName: 'Studio Nord', totalInclTaxCents: 120_000, posted: false },
  { kind: 'missing_receipt', id: 'tx_2', date: '2026-09-12', label: 'CB AMAZON', amountCents: -3_990 },
  { kind: 'missing_receipt', id: 'tx_4', date: '2026-09-12', label: 'OVH SAS', amountCents: -2_399, supplier: { name: 'OVHcloud', vendorId: 'ovhcloud' }, bankProvider: 'QONTO' },
  { kind: 'simple_expense', id: 'tx_3', side: 'debit', date: '2026-09-10', label: 'CB BISTROT', amountCents: 6_450 },
  { kind: 'vat_return', period: '2026-T3', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  { kind: 'closing_check', fiscalYearId: 'fy_2025', year: 2025, checks: [] },
]

describe('tools named by the requests', () => {
  const read = toolNames({ canWrite: false, canAdmin: false })
  const all = toolNames({ canWrite: true, canAdmin: true })

  it.each(TARGETS)('$kind names existing tools, the first one readable at every level', (target) => {
    const named = buildAiPrompt({ id: 'c1', name: 'A' }, target).match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []
    expect(named.length).toBeGreaterThan(0)
    const [first] = named
    expect(read.has(first ?? ''), `${first} is a read tool`).toBe(true)
    for (const name of named) expect(all.has(name), name).toBe(true)
  })
})
