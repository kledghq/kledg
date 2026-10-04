import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { findAccountByCode } from '@/lib/accounting/manage-accounts.service'

const CheckExistsQuery = z.object({
  code: z.string({ error: 'Le numéro de compte est requis' }).min(1, 'Le numéro de compte est requis'),
  fiscalYearId: z.string().optional(),
})

/** Whether the chart of a fiscal year (the active one by default) has an account with this number. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: CheckExistsQuery },
  async ({ companyId, query }) => {
    const account = await findAccountByCode(companyId, query.code, query.fiscalYearId)
    return NextResponse.json({ exists: !!account, account })
  },
)
