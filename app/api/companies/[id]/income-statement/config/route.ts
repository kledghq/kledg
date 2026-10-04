/**
 * API route for income statement configuration management
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { getIncomeStatementConfig } from '@/lib/reports/income-statement/config/get-income-statement-config.service'
import { createIncomeStatementConfigLine } from '@/lib/reports/config/manage-layouts.service'
import { CreateIncomeStatementConfigLineSchema } from '@/lib/reports/config/schemas'
import { VariantQuerySchema } from '@/lib/reports/report-query'

/** GET ?variant=: the layout, created from the PCG default the first time. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] }, query: VariantQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getIncomeStatementConfig(companyId, query.variant)),
)

/** POST: one line with its account codes, sense and order (the service checks the parent). */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CreateIncomeStatementConfigLineSchema },
  async ({ companyId, body }) => NextResponse.json(await createIncomeStatementConfigLine(companyId, body), { status: 201 }),
)
