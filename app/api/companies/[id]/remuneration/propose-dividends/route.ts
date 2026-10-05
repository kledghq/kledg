import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { ProposeDividendBodySchema, proposeScenarioDividends } from '@/lib/remuneration/save-remuneration-scenario.service'
import { REMUNERATION_WRITE } from '@/lib/remuneration/permissions'

/**
 * POST /api/companies/[id]/remuneration/propose-dividends { scenarioId }: the dividends of a saved scenario
 * become the dividends proposed in the approval of the accounts of its fiscal year (lib/approval).
 */
export const POST = companyRoute(
  { company: fromParam(), permission: REMUNERATION_WRITE, body: ProposeDividendBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await proposeScenarioDividends(companyId, body.scenarioId, user.id)),
)
