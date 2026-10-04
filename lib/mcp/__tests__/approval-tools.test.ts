/**
 * MCP tool get_year_end_formalities: the company guard with reports:read, the
 * regime of the legal form (officer title, who decides), amounts in euros,
 * documents with what each misses. The service is mocked (it has its own
 * database test); the pack is built by the real pure modules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/approval/get-approval.service', () => ({ getApproval: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getApproval } from '@/lib/approval/get-approval.service'
import { buildApprovalPack } from '@/lib/approval/pack'
import { ForbiddenError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import { complete, contextFor } from '@/lib/approval/__tests__/fixtures'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tool(name: string) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (toolName: string, _config: unknown, handler: Handler) => handlers.set(toolName, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers.get(name)!
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)

function viewFor(legalType: string, patch = {}) {
  const context = contextFor(legalType)
  const details = complete(patch)
  return { context, details, saved: null, pack: buildApprovalPack(context, details), persons: [], sources: [] }
}

describe('get_year_end_formalities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the regime of a SASU: the associé unique decides, the officer is the président', async () => {
    vi.mocked(getApproval).mockResolvedValue(viewFor('SASU'))
    const result = parse(await tool('get_year_end_formalities')({ companyId: 'c1', fiscalYearId: 'fy25' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getApproval).toHaveBeenCalledWith('c1', 'fy25')
    expect(result.regime).toMatchObject({ form: 'SASU', soleShareholder: true, officerTitle: 'président', decisionMode: 'sole', document: "Décision de l'associé unique" })
    expect(result.result).toBe(50_000)
    expect(result.allocation).toMatchObject({ legalReserve: 1_000, dividends: 20_000, retainedEarnings: 29_000 })
    expect(result.deadlines).toMatchObject({ approval: '2026-06-30' })
    expect(result.documents.map((d: { id: string }) => d.id)).toEqual(['management-report', 'decision', 'confidentiality', 'filing-checklist'])
  })

  it('lists what is missing for a SARL with nothing entered', async () => {
    vi.mocked(getApproval).mockResolvedValue({ ...viewFor('SARL'), details: complete({}), pack: buildApprovalPack(contextFor('SARL'), complete({ rcsCity: null })) })
    const result = parse(await tool('get_year_end_formalities')({ companyId: 'c1', fiscalYearId: 'fy25' }))
    expect(result.regime).toMatchObject({ form: 'SARL', officerTitle: 'gérant', decisionMode: 'meeting' })
    expect(result.documents.find((d: { id: string }) => d.id === 'decision').missing).toContain('Ville du greffe (RCS) où la société est immatriculée')
  })

  it('refuses a caller without reports:read on the company', async () => {
    guard.require.mockRejectedValueOnce(new ForbiddenError('Action non autorisée'))
    const result = await tool('get_year_end_formalities')({ companyId: 'c1', fiscalYearId: 'fy25' })
    expect(result.isError).toBe(true)
    expect(getApproval).not.toHaveBeenCalled()
  })
})
