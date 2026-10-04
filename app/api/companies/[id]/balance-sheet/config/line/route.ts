/**
 * API route for creating balance sheet line configurations
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { createBalanceSheetLine } from '@/lib/reports/config/manage-layouts.service'
import { CreateBalanceSheetLineSchema } from '@/lib/reports/config/schemas'

export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreateBalanceSheetLineSchema },
  async ({ companyId, body }) => NextResponse.json(await createBalanceSheetLine(companyId, body), { status: 201 }),
)
