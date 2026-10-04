/**
 * API route for individual balance sheet line configuration
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { deleteBalanceSheetLine, getBalanceSheetLine, updateBalanceSheetLine } from '@/lib/reports/config/manage-layouts.service'
import { UpdateBalanceSheetLineSchema } from '@/lib/reports/config/schemas'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getBalanceSheetLine(companyId, params.lineId as string)),
)

export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdateBalanceSheetLineSchema },
  async ({ params, companyId, body }) => NextResponse.json(await updateBalanceSheetLine(companyId, params.lineId as string, body)),
)

export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] } },
  async ({ params, companyId }) => {
    await deleteBalanceSheetLine(companyId, params.lineId as string)
    return NextResponse.json({ success: true })
  },
)
