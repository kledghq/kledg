/**
 * export_fec (full control) keeps the limits of export_report and of the FEC
 * route (KLEDG-R3-MCP-04): the export rate limit of the user on every call,
 * and the size cap of a file sent to an assistant. Services are mocked: the
 * FEC itself has its own tests.
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
vi.mock('@/lib/accounting/manage-fiscal-years.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/manage-fiscal-years.service')>()),
  ownedFiscalYear: vi.fn(async () => ({ id: 'fy1', year: 2025 })),
}))
vi.mock('@/lib/fec/export', () => ({ exportFec: vi.fn() }))
vi.mock('@/lib/fec/validator', () => ({ validateFec: vi.fn(() => ({ valid: true, errors: [], warnings: [] })) }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportFec } from '@/lib/fec/export'
import { MAX_MCP_FILE_BYTES } from '@/lib/mcp/file-result'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function exportFecTool(): Handler {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    {
      user: { id: 'u1', email: 'a@b.c', name: null, role: 'user' },
      canWrite: true,
      canAdmin: true,
      caller: { kind: 'apiKey', apiKeyId: 'k1' },
      executionMode: 'validation',
    },
  )
  return handlers.get('export_fec')!
}

const fec = (content: string) => ({ fileName: '123456782FEC20251231.txt', entries: 1, lines: 2, content })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('export_fec', () => {
  it('counts every call in the export rate limit of the user', async () => {
    vi.mocked(exportFec).mockResolvedValue(fec('JournalCode\tJournalLib\n') as never)
    const result = await exportFecTool()({ companyId: 'c1', fiscalYearId: 'fy1' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text)).toMatchObject({ fileName: '123456782FEC20251231.txt', content: 'JournalCode\tJournalLib\n' })
    expect(enforceRateLimit).toHaveBeenCalledWith('export', 'u1')
  })

  it('refuses a FEC above the size of a file sent to an assistant, in French', async () => {
    vi.mocked(exportFec).mockResolvedValue(fec('x'.repeat(MAX_MCP_FILE_BYTES + 1)) as never)
    const result = await exportFecTool()({ companyId: 'c1', fiscalYearId: 'fy1' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/^Fichier trop volumineux pour être transmis à l'assistant/)
  })

  it('stops at the rate limit before building the FEC', async () => {
    const { RateLimitError } = await import('@/lib/accounting/errors')
    vi.mocked(enforceRateLimit).mockRejectedValueOnce(new RateLimitError("Trop d'exports en une minute."))
    const result = await exportFecTool()({ companyId: 'c1', fiscalYearId: 'fy1' })
    expect(result.isError).toBe(true)
    expect(exportFec).not.toHaveBeenCalled()
  })
})
