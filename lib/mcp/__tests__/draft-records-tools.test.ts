/**
 * update_investment_grant (lib/mcp/drafts/records.ts): the amount already
 * transferred to the result is named as in create_investment_grant
 * (`alreadyTransferred`, alias `carried`), is left out of the body when the
 * assistant omits it (the service then keeps the stored value, issue #29),
 * and a field the tool does not know is refused rather than ignored. The
 * service is mocked; its database test covers what it keeps.
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
vi.mock('@/lib/investment-grants/manage-investment-grants.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/investment-grants/manage-investment-grants.service')>()),
  updateInvestmentGrant: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { updateInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools() {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite: true, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers
}

const GRANT = { label: 'Subvention région', amount: 1000, grantedOn: '2025-02-01', spreading: 'LINEAR', durationYears: 5 }
const saved = { id: 'g1', label: 'Subvention région', amount: '1000', carriedAmount: '200', spreading: 'LINEAR', fixedAsset: null, transfers: [] }

const update = (grant: Record<string, unknown>) => tools().get('update_investment_grant')!({ companyId: 'c1', grantId: 'g1', grant })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(updateInvestmentGrant).mockResolvedValue(saved as never)
})

describe('update_investment_grant', () => {
  it('sends alreadyTransferred to the service as carriedCents, like create_investment_grant', async () => {
    const result = await update({ ...GRANT, alreadyTransferred: 200.5 })
    expect(result.isError, result.content[0].text).toBeFalsy()
    expect(updateInvestmentGrant).toHaveBeenCalledWith('c1', 'g1', expect.objectContaining({ amountCents: 100_000, carriedCents: 20_050 }))
  })

  it('accepts the route name carried too, and refuses two different values', async () => {
    await update({ ...GRANT, carried: 200.5 })
    expect(updateInvestmentGrant).toHaveBeenCalledWith('c1', 'g1', expect.objectContaining({ carriedCents: 20_050 }))
    const both = await update({ ...GRANT, carried: 200.5, alreadyTransferred: 300 })
    expect(both.isError).toBe(true)
    expect(both.content[0].text).toMatch(/alreadyTransferred et carried/)
    expect(updateInvestmentGrant).toHaveBeenCalledTimes(1)
  })

  it('leaves carriedCents out of the body when neither is given: the service keeps the stored amount', async () => {
    await update(GRANT)
    const body = vi.mocked(updateInvestmentGrant).mock.calls[0][2]
    expect(body).not.toHaveProperty('carriedCents')
  })

  it('refuses a field the tool does not know instead of ignoring it', async () => {
    const result = await update({ ...GRANT, alreadyTransfered: 200 })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/alreadyTransfered/)
    expect(updateInvestmentGrant).not.toHaveBeenCalled()
  })
})
