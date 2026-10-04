/**
 * API route for balance sheet configuration management
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { getBalanceSheetConfig } from '@/lib/reports/balance-sheet/config/get-balance-sheet-config.service'
import { runBalanceSheetConfigAction } from '@/lib/reports/config/manage-layouts.service'
import { BalanceSheetConfigActionSchema } from '@/lib/reports/config/schemas'
import { VariantQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] }, query: VariantQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getBalanceSheetConfig(companyId, query.variant)),
)

/** POST { action: 'create_default', variant } | { action: 'create_line', ...line } */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: BalanceSheetConfigActionSchema },
  async ({ companyId, body }) => NextResponse.json(await runBalanceSheetConfigAction(companyId, body), { status: 201 }),
)
