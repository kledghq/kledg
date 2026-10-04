import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody } from '@/lib/api/route'
import { completePcgChart } from '@/lib/accounting/pcg-chart.service'

const CheckPcgComplianceBody = z.object({
  fiscalYearId: z.string().nullish(),
  includeOptionalAccounts: z.boolean().optional().default(false),
})

/**
 * POST { companyId, fiscalYearId?, includeOptionalAccounts? }: completes the
 * chart of the fiscal year (the active one by default) with the missing PCG
 * accounts and corrects the parent links of its PCG accounts. Answers
 * { success, missingCount, addedCount, fixedRelationsCount, message }.
 *
 * Permission: ledger manage (it creates and re-parents accounts).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: CheckPcgComplianceBody },
  async ({ companyId, body }) => NextResponse.json(await completePcgChart(companyId, body)),
)
