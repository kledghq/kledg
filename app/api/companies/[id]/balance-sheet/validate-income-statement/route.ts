/**
 * API route for validating balance sheet against income statement
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { validateBalanceSheetAgainstIncomeStatement } from '@/lib/reports/balance-sheet/validate-income-statement.service'
import { assertFiscalYearsOwned, StatementQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] }, query: StatementQuerySchema },
  async ({ companyId, query }) => {
    await assertFiscalYearsOwned(companyId, query.fiscalYearId)
    return NextResponse.json(await validateBalanceSheetAgainstIncomeStatement(companyId, query.fiscalYearId))
  },
)
