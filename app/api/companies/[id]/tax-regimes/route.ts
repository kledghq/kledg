import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import {
  addTaxRegime,
  AddTaxRegimeSchema,
  deleteTaxRegime,
  DeleteTaxRegimeQuerySchema,
  getTaxRegimeHistory,
  TaxRegimeQuerySchema,
  updateTaxRegime,
  UpdateTaxRegimeSchema,
} from '@/lib/companies/tax-regimes'

/** GET ?regimeType=vat|corporateTax: the regime history, latest first. */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] }, query: TaxRegimeQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getTaxRegimeHistory(companyId, query.regimeType)),
)

/** POST: adds a regime and closes the open one of the same type the day before. */
export const POST = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: AddTaxRegimeSchema },
  async ({ companyId, body }) => NextResponse.json(await addTaxRegime(companyId, body)),
)

/** PATCH: updates a regime of the company (its id in the body). */
export const PATCH = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: UpdateTaxRegimeSchema },
  async ({ companyId, body: { id, ...input } }) => NextResponse.json(await updateTaxRegime(companyId, id, input)),
)

/** DELETE ?id=: removes a regime of the company. */
export const DELETE = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, query: DeleteTaxRegimeQuerySchema },
  async ({ companyId, query }) => {
    await deleteTaxRegime(companyId, query.id)
    return NextResponse.json({ success: true })
  },
)
