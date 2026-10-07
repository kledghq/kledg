/**
 * API route for one balance sheet configuration template of the company
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { deleteBalanceSheetTemplate } from '@/lib/reports/balance-sheet/config/manage-templates.service'

/** DELETE: deletes a template of the company; Kledg's shared templates and those of other companies answer 404 (KLEDG-R3-AUTHZ-01). */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] } },
  async ({ companyId, params }) => {
    await deleteBalanceSheetTemplate(companyId, params.templateId as string)
    return new NextResponse(null, { status: 204 })
  },
)
