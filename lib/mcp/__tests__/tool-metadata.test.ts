/**
 * Guard of the metadata of every MCP tool, at every access level and in
 * both execution modes (lib/mcp/tool-meta.ts):
 * - a French title and the four annotations, consistent with the level
 *   (read tools read only, never destructive, idempotent, closed world);
 * - a description that states the unit of amounts (euros, never cents),
 *   the access level and the right it needs, and what the tool never does;
 * - one amount convention: no input is described in cents;
 * - no em or en dash anywhere.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { AMOUNTS_IN_EUROS, NO_AMOUNTS, describeTool, permissionLabel } from '@/lib/mcp/tool-meta'
import type { McpAccess } from '@/lib/mcp/company-access'

/** Tools that call a bank provider (Qonto, Revolut, Ponto) or the public company directory: the only open world tools. */
const OPEN_WORLD = new Set(['sync_bank', 'sync_bank_data', 'upload_receipt', 'import_qonto_invoices', 'get_qonto_statements', 'list_qonto_receipts', 'get_file', 'lookup_siren', 'create_draft_invoice', 'manage_invoice'])

type Config = {
  title?: string
  description?: string
  annotations?: Record<string, unknown>
  inputSchema?: z.ZodType
}

const user = { id: 'u1', email: 'a@b.c', name: null, role: 'user' }
const caller = { kind: 'apiKey' as const, apiKeyId: 'k1' }

const LEVELS: Record<string, Omit<McpAccess, 'user' | 'caller'>> = {
  read: { canWrite: false, canAdmin: false, executionMode: 'validation' },
  write: { canWrite: true, canAdmin: false, executionMode: 'validation' },
  'admin (validation)': { canWrite: true, canAdmin: true, executionMode: 'validation' },
  'admin (automatic)': { canWrite: true, canAdmin: true, executionMode: 'automatic' },
}

function toolsOf(level: Omit<McpAccess, 'user' | 'caller'>): Map<string, Config> {
  const tools = new Map<string, Config>()
  registerKledgTools({ registerTool: (name: string, config: Config) => tools.set(name, config) } as never, { user, caller, ...level })
  return tools
}

describe('MCP tool metadata', () => {
  for (const [level, access] of Object.entries(LEVELS)) {
    describe(level, () => {
      const tools = toolsOf(access)

      it('gives every tool a French title and the four annotations', () => {
        expect(tools.size).toBeGreaterThan(level === 'read' ? 30 : 40)
        for (const [name, config] of tools) {
          expect(config.title, name).toBeTruthy()
          const a = config.annotations ?? {}
          for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
            expect(typeof a[hint], `${name}.${hint}`).toBe('boolean')
          }
          if (a.readOnlyHint) {
            expect(a.destructiveHint, name).toBe(false)
            expect(a.idempotentHint, name).toBe(true)
          }
          // Only the tools that call a bank provider or the company directory reach a third party.
          expect(a.openWorldHint, name).toBe(OPEN_WORLD.has(name))
        }
      })

      it('describes the unit, the access level, the right and what the tool never does', () => {
        for (const [name, config] of tools) {
          const description = config.description ?? ''
          expect(description.includes(AMOUNTS_IN_EUROS) || description.includes(NO_AMOUNTS), `${name}: unit`).toBe(true)
          expect(description, name).toMatch(/Access: kledg:(read|write|admin)/)
          expect(description, name).toMatch(/(right|rights) in the company|membership of the company|company creation policy/)
          expect(description, name).toMatch(/ Never [a-z]/)
        }
      })

      it('states the level matching the annotations', () => {
        for (const [name, config] of tools) {
          const description = config.description ?? ''
          if (description.includes('Access: kledg:read')) expect(config.annotations?.readOnlyHint, name).toBe(true)
          if (level === 'read') expect(description, name).toContain('Access: kledg:read')
        }
      })

      it('describes no input in cents and uses no dash', () => {
        for (const [name, config] of tools) {
          const schema = config.inputSchema ? JSON.stringify(z.toJSONSchema(config.inputSchema, { unrepresentable: 'any' })) : ''
          expect(schema.replaceAll('never in cents', ''), name).not.toMatch(/\bcents?\b/i)
          expect(`${config.title} ${config.description} ${schema}`, name).not.toMatch(/[\u2013\u2014]/)
        }
      })
    })
  }

  it('lists the rights of a tool and its level in one sentence', () => {
    expect(permissionLabel({ entries: ['create', 'validate'] })).toBe('entries:create and entries:validate')
    expect(permissionLabel([{ budgets: ['manage'] }, { banking: ['reconcile'] }])).toBe('budgets:manage and banking:reconcile')
    expect(describeTool({ summary: 'Does X.', access: 'write', permission: [{ budgets: ['manage'] }, { banking: ['reconcile'] }], amounts: 'euros', never: 'posts anything.' })).toBe(
      `Does X. ${AMOUNTS_IN_EUROS} Access: kledg:write (read and drafts) and the budgets:manage and banking:reconcile rights in the company. Never posts anything.`,
    )
    expect(describeTool({ summary: 'Lists.', access: 'read', permission: 'membership', amounts: 'none', never: 'writes.' })).toBe(
      `Lists. ${NO_AMOUNTS} Access: kledg:read and membership of the company. Never writes.`,
    )
  })
})
