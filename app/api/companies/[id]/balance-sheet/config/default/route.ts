/**
 * API route to reset balance sheet configuration to default PCG
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { resetBalanceSheetLayout } from '@/lib/reports/config/manage-layouts.service'
import { ResetLayoutSchema } from '@/lib/reports/config/schemas'

export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: ResetLayoutSchema },
  async ({ companyId, body }) => NextResponse.json(await resetBalanceSheetLayout(companyId, body.variant), { status: 201 }),
)
