/**
 * API route for balance sheet comparison (N vs N-1)
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { generateBalanceSheetComparison } from '@/lib/reports/balance-sheet/generate-comparison.service'
import { assertFiscalYearsOwned, ComparisonQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] }, query: ComparisonQuerySchema },
  async ({ companyId, query }) => {
    await assertFiscalYearsOwned(companyId, query.currentFiscalYearId, query.previousFiscalYearId)
    return NextResponse.json(
      await generateBalanceSheetComparison(companyId, query.currentFiscalYearId, query.previousFiscalYearId, query.variant),
    )
  },
)
