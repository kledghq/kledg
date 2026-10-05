import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { getRuleTemplatePrefill } from '@/lib/rules-library/manage-rule-templates.service'

/**
 * GET /api/rule-templates/[id]?companyId=: one template of the rules library
 * with its accounts mapped to the company's chart, as the rule editor
 * prefills it (/rules/new?template=<id>).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId, params }) => NextResponse.json(await getRuleTemplatePrefill(companyId, params.id as string)),
)
