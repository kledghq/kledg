/**
 * API route for resetting income statement configuration to default
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { resetIncomeStatementLayout } from '@/lib/reports/config/manage-layouts.service'
import { ResetLayoutSchema } from '@/lib/reports/config/schemas'

export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: ResetLayoutSchema },
  async ({ companyId, body }) => NextResponse.json(await resetIncomeStatementLayout(companyId, body.variant)),
)
