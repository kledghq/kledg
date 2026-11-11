/**
 * MCP tool of the liasse fiscale (lib/mcp/liasse-tools.ts): get_liasse_fiscale
 * reads with reports:read, returns every table of the regime with where it
 * is prepared, and the tables prepared here box by box, amounts in euros,
 * boxes to fill by hand flagged with their reason. The service is mocked
 * (liasse-routes.db.test.ts covers it on PostgreSQL); the view is built by
 * the real pure modules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/liasse/get-liasse.service', () => ({ getLiasse: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getLiasse } from '@/lib/liasse/get-liasse.service'
import { assembleLiasse } from '@/lib/liasse/build-liasse'
import { buildForm2033D } from '@/lib/liasse/form-2033d'
import { vatTotals } from '@/lib/liasse/vat'
import { ForbiddenError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools() {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: false, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers
}

const VIEW = assembleLiasse({
  status: 'ready',
  regime: 'simplified',
  company: { name: 'Atelier Lumen', siren: '111111111' },
  fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: true },
  forms: [
    buildForm2033D({
      provisions: {
        movements: [{ code: '151100', openingCents: 100_000, increaseCents: 50_000, decreaseCents: 0, closingCents: 150_000 }],
        register: [],
        balanceSheet: { regulated: { box: '140', cents: 0 }, riskCharges: { box: '154', cents: 150_000 } },
        incomeStatement: null,
      },
      deficits: { known: true, openingCents: 0, imputedCents: 0, createdCents: 0 },
      deficitsWhy: '',
      vat: vatTotals([]),
    }),
  ],
  warnings: [],
})

describe('get_liasse_fiscale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getLiasse).mockResolvedValue(VIEW)
  })

  it('returns the tables of the regime and the boxes in euros, those to fill by hand flagged', async () => {
    const result = await tools().get('get_liasse_fiscale')!({ companyId: 'c1', fiscalYearId: 'fy' })
    expect(result.isError, result.content[0].text).toBeFalsy()
    const data = JSON.parse(result.content[0].text)
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(getLiasse).toHaveBeenCalledWith('c1', 'fy', expect.objectContaining({ userId: 'u1' }))
    expect(data.regime).toBe('simplified')
    expect(data.tables.find((t: { form: string }) => t.form === '2033-C-SD')).toMatchObject({ where: 'page', page: '/reports/fixed-asset-movements' })
    const cells = data.forms[0].sections.flatMap((s: { rows: Array<{ cells: unknown[] }> }) => s.rows.flatMap((r) => r.cells))
    expect(cells.find((c: { box: string }) => c.box === '626')).toMatchObject({ value: 1500, unit: 'amount', source: 'books', toFillByHand: false, accounts: ['151100'] })
    expect(cells.find((c: { box: string }) => c.box === '982 bis')).toMatchObject({ value: null, toFillByHand: true, source: 'manual' })
    expect(data.filing).toContain('partenaire EDI')
  })

  it('refuses without reports:read', async () => {
    guard.require.mockRejectedValueOnce(new ForbiddenError('Action non autorisée'))
    const result = await tools().get('get_liasse_fiscale')!({ companyId: 'c1', fiscalYearId: 'fy' })
    expect(result.isError).toBe(true)
    expect(getLiasse).not.toHaveBeenCalled()
  })
})
