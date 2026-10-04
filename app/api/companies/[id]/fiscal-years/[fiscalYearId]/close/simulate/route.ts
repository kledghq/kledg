import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { simulateCompanyFiscalYearClosure } from '@/lib/accounting/manage-fiscal-years.service'

/** GET: what the closing would book; 400 with `details` and `warnings` when the year cannot be closed. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { closing: ['execute'] } },
  async ({ params, companyId }) =>
    NextResponse.json(await simulateCompanyFiscalYearClosure(companyId, params.fiscalYearId as string)),
)
