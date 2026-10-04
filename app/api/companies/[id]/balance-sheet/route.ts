/**
 * API route for balance sheet generation
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { assertFiscalYearsOwned, StatementQuerySchema } from '@/lib/reports/report-query'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] }, query: StatementQuerySchema },
  async ({ companyId, query }) => {
    await assertFiscalYearsOwned(companyId, query.fiscalYearId)
    const balanceSheet = await generateBalanceSheet(companyId, query.fiscalYearId, query.variant)
    return NextResponse.json(balanceSheet, { headers: NO_CACHE_HEADERS })
  },
)
