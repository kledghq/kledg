/**
 * MCP prompts (lib/mcp/prompts.ts): the five guided workflows are listed
 * with a French title, a description and string arguments; each returns a
 * user message that names only tools registered for the connection's
 * level (draft tools only with kledg:write), never a high-impact tool, in
 * French with a non-breaking space before colons and without dashes.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))

import { KLEDG_PROMPTS, monthPeriod, promptText, registerKledgPrompts } from '@/lib/mcp/prompts'
import { registerKledgTools } from '@/lib/mcp/tools'
import type { McpAccess } from '@/lib/mcp/company-access'

type PromptResult = { description?: string; messages: Array<{ role: string; content: { type: string; text: string } }> }
type PromptConfig = { title: string; description: string; argsSchema: z.ZodObject }
type PromptHandler = (args: Record<string, unknown>) => PromptResult

const user = { id: 'u1', email: 'a@b.c', name: null, role: 'user' }
const caller = { kind: 'apiKey' as const, apiKeyId: 'k1' }

function access(canWrite: boolean): McpAccess {
  return { user, caller, canWrite, canAdmin: false, executionMode: 'validation' }
}

function prompts(canWrite: boolean) {
  const registered = new Map<string, { config: PromptConfig; handler: PromptHandler }>()
  registerKledgPrompts({ registerPrompt: (name: string, config: PromptConfig, handler: PromptHandler) => registered.set(name, { config, handler }) } as never, access(canWrite))
  return registered
}

function toolNames(canWrite: boolean): Set<string> {
  const names = new Set<string>()
  registerKledgTools({ registerTool: (name: string) => names.add(name) } as never, access(canWrite))
  return names
}

const NAMES = ['cloture_du_mois', 'preparer_cloture_exercice', 'revue_budgetaire', 'sante_financiere', 'approbation_des_comptes']
const HIGH_IMPACT = ['validate_entries', 'close_fiscal_year', 'allocate_result', 'delete_draft_entry', 'reverse_entry', 'generate_depreciation', 'import_statement', 'letter_entry_lines']

describe('MCP prompts', () => {
  it('lists the five workflows with a French title, a description and string arguments', () => {
    const listed = prompts(false)
    expect([...listed.keys()]).toEqual(NAMES)
    expect([...listed.values()].map((p) => p.config.title)).toEqual([
      'Clôture du mois',
      "Préparer la clôture de l'exercice",
      'Revue budgétaire',
      'Santé financière',
      'Approbation des comptes',
    ])
    for (const [name, { config }] of listed) {
      expect(config.description, name).toBeTruthy()
      const schema = z.toJSONSchema(config.argsSchema) as { properties: Record<string, { type: string }>; required?: string[] }
      expect(schema.required, name).toEqual(['companyId'])
      for (const [arg, property] of Object.entries(schema.properties)) expect(property.type, `${name}.${arg}`).toBe('string')
    }
  })

  for (const canWrite of [false, true]) {
    describe(canWrite ? 'with kledg:write' : 'read only', () => {
      const registered = prompts(canWrite)
      const tools = toolNames(canWrite)

      it('returns one user message naming only tools of the connection, never a high-impact one', () => {
        for (const [name, { handler }] of registered) {
          const result = handler({ companyId: 'c1', fiscalYearId: 'fy-1' })
          expect(result.messages, name).toHaveLength(1)
          expect(result.messages[0].role).toBe('user')
          const text = result.messages[0].content.text
          expect(text, name).toContain('c1')
          const named = [...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).filter((n) => n !== 'reviewUrl')
          expect(named.length, name).toBeGreaterThan(1)
          for (const tool of named) expect(tools.has(tool), `${name}: ${tool}`).toBe(true)
          for (const tool of HIGH_IMPACT) expect(text, name).not.toContain(tool)
          expect(text, name).toContain('Ne validez')
        }
      })

      it('is written in French with a non-breaking space before colons and no dash', () => {
        for (const [name, { config, handler }] of registered) {
          const text = `${config.title} ${config.description} ${handler({ companyId: 'c1' }).messages[0].content.text}`
          expect(text, name).not.toMatch(/ :/)
          expect(text, name).not.toMatch(/[\u2013\u2014]/)
        }
      })
    })
  }

  it('prepares drafts only with kledg:write and otherwise points to Kledg', () => {
    const closing = KLEDG_PROMPTS.find((p) => p.name === 'preparer_cloture_exercice')!
    expect(promptText(closing, { companyId: 'c1' }, true)).toContain('`prepare_year_end_entries`')
    const readOnly = promptText(closing, { companyId: 'c1' }, false)
    expect(readOnly).not.toContain('prepare_year_end_entries')
    expect(readOnly).toContain('page Travaux de clôture')
    const approval = KLEDG_PROMPTS.find((p) => p.name === 'approbation_des_comptes')!
    expect(promptText(approval, { companyId: 'c1', fiscalYearId: 'fy-1' }, true)).toContain('`update_year_end_formalities`')
    const budget = KLEDG_PROMPTS.find((p) => p.name === 'revue_budgetaire')!
    expect(promptText(budget, { companyId: 'c1', throughMonth: '2026-06' }, false)).toContain("jusqu'au mois 2026-06 inclus")
    const health = KLEDG_PROMPTS.find((p) => p.name === 'sante_financiere')!
    expect(promptText(health, { companyId: 'c1' }, false)).toContain('`get_financial_ratios`')
  })

  it('closes the month given, else the previous one, with its first and last day', () => {
    const now = new Date('2026-10-04T10:00:00Z')
    expect(monthPeriod('2026-02', now)).toEqual({ month: '2026-02', from: '2026-02-01', to: '2026-02-28' })
    expect(monthPeriod(undefined, now)).toEqual({ month: '2026-09', from: '2026-09-01', to: '2026-09-30' })
    expect(monthPeriod(undefined, new Date('2027-01-15T00:00:00Z'))).toEqual({ month: '2026-12', from: '2026-12-01', to: '2026-12-31' })
    expect(monthPeriod('2026-13', now).month).toBe('2026-09')
    const month = KLEDG_PROMPTS.find((p) => p.name === 'cloture_du_mois')!
    const text = promptText(month, { companyId: 'c1', month: '2026-03' }, true, now)
    expect(text).toContain('du 2026-03-01 au 2026-03-31')
    expect(text).toContain('`get_bank_sync_status`')
    expect(text).toContain('`list_missing_receipts`')
  })
})
