import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromParam } from '@/lib/api/route'
import { createFiscalYear, listFiscalYears } from '@/lib/accounting/manage-fiscal-years.service'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { entries: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listFiscalYears(companyId)),
)

/** Dates are calendar days (yyyy-mm-dd), checked by the service. */
const CreateFiscalYearBody = z.object({
  year: z.coerce
    .number({ error: "L'année est requise" })
    .int("L'année doit être un nombre entier")
    .min(1900, "L'année doit être comprise entre 1900 et 2200")
    .max(2200, "L'année doit être comprise entre 1900 et 2200"),
  startDate: z.string({ error: 'La date de début est requise' }),
  endDate: z.string({ error: 'La date de fin est requise' }),
})

/** Creates a fiscal year with the PCG chart (201). 409 when the year exists. */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { ledger: ['manage'] }, body: CreateFiscalYearBody },
  async ({ companyId, body }) => NextResponse.json(await createFiscalYear(companyId, body), { status: 201 }),
)
