import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { nextDefinitiveEntryNumber } from '@/lib/accounting/services'
import { getFiscalYearForEntry } from '@/lib/accounting/fiscal-year-utils'
import { parisDayOf, toEntryDate } from '@/lib/accounting/entry-date'

/** ?date=yyyy-mm-dd (checked by toEntryDate), today in France by default. */
const NextNumberQuery = z.object({ date: z.string().optional() })

/**
 * Number the next validated entry of the fiscal year would get. Informative
 * only: numbers are assigned at validation (drafts have none).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: NextNumberQuery },
  async ({ companyId, query }) => {
    // Fiscal year of the date (today by default)
    const date = toEntryDate(query.date || parisDayOf(new Date()))
    const fiscalYear = await getFiscalYearForEntry(companyId, date)
    return NextResponse.json({ nextNumber: await nextDefinitiveEntryNumber(fiscalYear.id) })
  },
)
