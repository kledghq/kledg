/**
 * API route for income statement generation
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import { assertFiscalYearsOwned, StatementQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] }, query: StatementQuerySchema },
  async ({ companyId, query }) => {
    await assertFiscalYearsOwned(companyId, query.fiscalYearId)
    const incomeStatement = await generateIncomeStatement(companyId, query.fiscalYearId, query.variant)
    return NextResponse.json(incomeStatement, { headers: NO_CACHE_HEADERS })
  },
)
