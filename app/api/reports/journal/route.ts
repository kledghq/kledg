import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getJournalReport } from '@/lib/reports/journal/get-journal-report.service'
import { JournalReportQuerySchema } from '@/lib/reports/report-query'

/** GET ?companyId=&journalId=&startDate=&endDate=: validated entries per journal. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['read'] }, query: JournalReportQuerySchema },
  // The report filters entries by company: a journal of another company matches nothing.
  async ({ companyId, query }) => NextResponse.json(await getJournalReport({ companyId, ...query }), { headers: NO_CACHE_HEADERS }),
)
