/**
 * API route for balance sheet configuration history
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { readBalanceSheetLineHistory, runBalanceSheetHistoryAction } from '@/lib/reports/config/manage-layouts.service'
import { ConfigHistoryActionSchema, ConfigHistoryQuerySchema } from '@/lib/reports/config/schemas'

/** GET ?configId= [&version= | &version1=&version2=]: the history of a line, one version, or two compared. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] }, query: ConfigHistoryQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await readBalanceSheetLineHistory(companyId, query)),
)

/** POST { action: 'create_snapshot' | 'restore', configId, version?, changeReason? } */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: ConfigHistoryActionSchema },
  async ({ companyId, user, body }) => {
    const { created, result } = await runBalanceSheetHistoryAction(companyId, user.id, body)
    return NextResponse.json(result, { status: created ? 201 : 200 })
  },
)
