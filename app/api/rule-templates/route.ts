import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { listRuleTemplates } from '@/lib/rules-library/manage-rule-templates.service'

/**
 * GET /api/rule-templates?companyId=: the rules library (bibliothèque de
 * règles) for the company: every template with its status (already added,
 * near duplicates, accounts of the chart) and the templates suggested by the
 * company's bank transactions of the last 12 months. Same right as the
 * rules list (GET /api/transaction-rules).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listRuleTemplates(companyId)),
)
