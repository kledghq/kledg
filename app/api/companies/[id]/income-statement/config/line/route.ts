/**
 * API route for creating income statement line configurations
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { createIncomeStatementLine } from '@/lib/reports/config/manage-layouts.service'
import { CreateIncomeStatementLineSchema } from '@/lib/reports/config/schemas'

export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreateIncomeStatementLineSchema },
  async ({ companyId, body }) => NextResponse.json(await createIncomeStatementLine(companyId, body), { status: 201 }),
)
