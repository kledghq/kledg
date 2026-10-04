/**
 * MCP tools of the group view: get_group_view and get_participations. The
 * holding goes through the company guard with reports:read; every
 * subsidiary is reached through the same guard (the GroupAccess handed to
 * the services delegates to it), so the connection's company grant applies
 * to the subsidiaries too. Amounts in euros, percentages in percent.
 * Services are mocked: the database tests (app/api/__tests__/group-routes,
 * lib/__tests__/security/mcp-authorization) run them for real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn<(companyId: string, permission: unknown) => Promise<void>>(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/group/get-group-view.service', () => ({ getGroupView: vi.fn() }))
vi.mock('@/lib/group/get-participations.service', () => ({ getParticipations: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getGroupView, type GroupView } from '@/lib/group/get-group-view.service'
import { getParticipations, type ParticipationsReport } from '@/lib/group/get-participations.service'
import { ZERO_FIGURES } from '@/lib/group/combine'
import type { GroupAccess } from '@/lib/management-fees/access'
import { NotFoundError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function server() {
  const handlers = new Map<string, Handler>()
  registerKledgTools({ registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never, {
    user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' },
    canWrite: false,
    canAdmin: false,
    caller: { kind: 'apiKey', apiKeyId: 'k1' },
    executionMode: 'validation',
  })
  return handlers
}

const parse = (result: ToolResult) => JSON.parse(result.content[0].text)
const fy = { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }

beforeEach(() => {
  vi.clearAllMocks()
  guard.require.mockImplementation(async () => {})
})

describe('get_group_view', () => {
  it('reads the holding through the guard, every subsidiary through the same guard, and answers in euros', async () => {
    vi.mocked(getGroupView).mockImplementation(async (_holding, _query, access: GroupAccess) => {
      await access.require('s1', { reports: ['read'] })
      const figures = { ...ZERO_FIGURES, chiffreAffairesCents: 1_234_550 }
      return {
        holding: { id: 'h1', name: 'Holding' },
        fiscalYear: fy,
        members: [
          { id: 'h1', name: 'Holding', siren: null, role: 'holding', ownershipBp: null, fiscalYear: fy, samePeriod: true, figures },
          { id: 's1', name: 'Filiale Nord', siren: null, role: 'subsidiary', ownershipBp: 8000, fiscalYear: fy, samePeriod: true, figures },
        ],
        unreachable: [{ name: null, reason: 'out_of_reach' }],
        truncated: 0,
        combined: { ...figures, chiffreAffairesCents: 2_469_100 },
        eliminations: {
          operations: [{ sellerId: 'h1', buyerId: 's1', categories: ['management_fee'], revenueCents: 100_000, chargeCents: 90_000, gapCents: 10_000 }],
          dividends: [],
          balances: [],
          effect: { ...ZERO_FIGURES, chiffreAffairesCents: -100_000 },
        },
        afterEliminations: { ...figures, chiffreAffairesCents: 2_369_100 },
        flows: [],
        treasury: [{ month: '2026-01', totalCents: 50_000, byCompany: {} }],
        titresParticipationCents: 0,
        warnings: [],
      } satisfies GroupView
    })
    const data = parse(await server().get('get_group_view')!({ companyId: 'h1' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(guard.require).toHaveBeenCalledWith('s1', { reports: ['read'] })
    expect(data.companies[1]).toMatchObject({ name: 'Filiale Nord', ownershipPercent: 80, figures: { revenue: 12345.5 } })
    expect(data).toMatchObject({ notAccessibleSubsidiaries: 1, notAccessibleNames: [], combined: { revenue: 24691 }, afterEliminations: { revenue: 23691 } })
    expect(data.operations).toEqual([{ seller: 'Holding', buyer: 'Filiale Nord', kinds: ['Frais de gestion'], revenue: 1000, charges: 900, gap: 100 }])
    expect(data.notice).toContain('ANC 2020-01')
  })

  it('answers an error when the holding is outside the grant, without calling the service', async () => {
    guard.require.mockRejectedValueOnce(new NotFoundError('Société introuvable'))
    const result = await server().get('get_group_view')!({ companyId: 'other' })
    expect(result.isError).toBe(true)
    expect(getGroupView).not.toHaveBeenCalled()
  })
})

describe('get_participations', () => {
  it('reports the participations in euros and percent', async () => {
    vi.mocked(getParticipations).mockResolvedValue({
      holding: { id: 'h1', name: 'Holding' },
      fiscalYear: fy,
      rows: [
        {
          subsidiaryId: 's1',
          name: 'Filiale Nord',
          siren: '931000020',
          kind: 'filiale',
          ownershipBp: 8000,
          numberOfShares: 800,
          bookValueGrossCents: 8_000_000,
          depreciationCents: 0,
          bookValueNetCents: 8_000_000,
          fiscalYear: fy,
          samePeriod: true,
          capitalCents: 1_000_000,
          capitauxPropresCents: 9_000_000,
          quotePartCents: 7_200_000,
          chiffreAffairesCents: 10_000_000,
          resultatCents: 9_000_000,
          loansCents: 2_500_000,
          dividendsCents: 1_500_000,
        },
      ],
      unreachable: [],
      unattributed: [{ accountCode: '261200', label: 'Titres B', cents: 3_000_000 }],
      totals: { bookValueGrossCents: 8_000_000, depreciationCents: 0, bookValueNetCents: 8_000_000, dividendsCents: 1_500_000 },
    } satisfies ParticipationsReport)
    const data = parse(await server().get('get_participations')!({ companyId: 'h1', fiscalYearId: 'fy' }))
    expect(guard.require).toHaveBeenCalledWith('h1', { reports: ['read'] })
    expect(getParticipations).toHaveBeenCalledWith('h1', { fiscalYearId: 'fy' }, expect.objectContaining({ userId: 'u1' }))
    expect(data.participations[0]).toMatchObject({ category: 'Filiale (plus de 50 %)', ownershipPercent: 80, bookValueNet: 80000, equityShare: 72000, dividendsReceived: 15000 })
    expect(data.unattributedInvestments).toEqual([{ account: '261200', label: 'Titres B', amount: 30000 }])
  })
})
