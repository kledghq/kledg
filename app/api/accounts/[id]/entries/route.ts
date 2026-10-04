import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfAccount } from '@/lib/api/resources'
import { getAccountLedger } from '@/lib/accounting/manage-accounts.service'

const AccountEntriesQuery = z.object({ fiscalYearId: z.string().optional() })

/** Entry lines of the account (of one fiscal year with ?fiscalYearId=), oldest first, with totals and balance. */
export const GET = companyRoute(
  { company: fromResource(companyOfAccount), permission: { entries: ['read'] }, query: AccountEntriesQuery },
  async ({ params, companyId, query }) => NextResponse.json(await getAccountLedger(companyId, params.id as string, query.fiscalYearId)),
)
