import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromParam } from '@/lib/api/route'
import { deleteFiscalYear } from '@/lib/accounting/delete-fiscal-year.service'
import { getFiscalYear, updateFiscalYearDates } from '@/lib/accounting/manage-fiscal-years.service'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { entries: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getFiscalYear(companyId, params.fiscalYearId as string)),
)

const UpdateFiscalYearBody = z.object({
  startDate: z.string({ error: 'La date de début est requise' }),
  endDate: z.string({ error: 'La date de fin est requise' }),
})

/** New dates of an open fiscal year (409 when it is closed, 400 when they overlap another open year). */
export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { ledger: ['manage'] }, body: UpdateFiscalYearBody },
  async ({ params, companyId, body }) =>
    NextResponse.json(await updateFiscalYearDates(companyId, params.fiscalYearId as string, body)),
)

/** Deletes an open fiscal year without entries (204; 409 when closed or holding entries). */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { ledger: ['manage'] } },
  async ({ params, companyId }) => {
    await deleteFiscalYear(companyId, params.fiscalYearId as string)
    return new NextResponse(null, { status: 204 })
  },
)
