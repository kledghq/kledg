import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfInvestmentGrant } from '@/lib/api/resources'
import { deleteInvestmentGrant, GrantBodySchema, updateInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'

const company = fromResource(companyOfInvestmentGrant)

/** PATCH /api/investment-grants/[id]: replaces the grant (its terms are fixed once a transfer is validated). */
export const PATCH = companyRoute({ company, permission: { entries: ['create'] }, body: GrantBodySchema }, async ({ companyId, params, body }) =>
  NextResponse.json(await updateInvestmentGrant(companyId, params.id as string, body)),
)

/** DELETE /api/investment-grants/[id]: with its draft transfers (409 once a transfer is validated). */
export const DELETE = companyRoute({ company, permission: { entries: ['delete'] } }, async ({ companyId, params }) => {
  await deleteInvestmentGrant(companyId, params.id as string)
  return new NextResponse(null, { status: 204 })
})
