/**
 * API route for balance sheet configuration templates
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { listBalanceSheetTemplates } from '@/lib/reports/balance-sheet/config/manage-templates.service'
import { runBalanceSheetTemplateAction } from '@/lib/reports/config/manage-layouts.service'
import { TemplateActionSchema } from '@/lib/reports/config/schemas'
import { VariantQuerySchema } from '@/lib/reports/report-query'

/** GET ?variant=: public templates and the company's own private ones. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] }, query: VariantQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listBalanceSheetTemplates(companyId, query.variant)),
)

/** POST { action: 'create', name, description?, variant, isPublic? } | { action: 'apply', templateId } */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: TemplateActionSchema },
  async ({ companyId, user, body }) => {
    const { created, result } = await runBalanceSheetTemplateAction(companyId, user.id, body)
    return NextResponse.json(result, { status: created ? 201 : 200 })
  },
)
