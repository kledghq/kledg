/**
 * API route for managing individual income statement line configurations
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  deleteIncomeStatementLine,
  getIncomeStatementLine,
  updateIncomeStatementLine,
} from '@/lib/reports/config/manage-layouts.service'
import { UpdateIncomeStatementLineSchema } from '@/lib/reports/config/schemas'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getIncomeStatementLine(companyId, params.lineId as string)),
)

export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdateIncomeStatementLineSchema },
  async ({ params, companyId, body }) =>
    NextResponse.json(await updateIncomeStatementLine(companyId, params.lineId as string, body)),
)

export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] } },
  async ({ params, companyId }) => {
    await deleteIncomeStatementLine(companyId, params.lineId as string)
    return NextResponse.json({ success: true })
  },
)
