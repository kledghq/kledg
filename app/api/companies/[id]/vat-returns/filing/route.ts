import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { deleteVatFiling, recordVatFiling, VatFilingBodySchema, VatFilingQuerySchema } from '@/lib/vat-returns/record-vat-filing.service'
import { VAT_RETURN_WRITE } from '@/lib/vat-returns/permissions'

/** PUT /api/companies/[id]/vat-returns/filing { period, filedOn, amountDueCents, creditCents }: records that the user filed the return on impots.gouv.fr. */
export const PUT = companyRoute(
  { company: fromParam(), permission: VAT_RETURN_WRITE, body: VatFilingBodySchema },
  async ({ companyId, body, user }) => NextResponse.json(await recordVatFiling(companyId, body, { userId: user.id })),
)

/** DELETE /api/companies/[id]/vat-returns/filing?period=: removes that record. */
export const DELETE = companyRoute(
  { company: fromParam(), permission: VAT_RETURN_WRITE, query: VatFilingQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await deleteVatFiling(companyId, query.period)),
)
