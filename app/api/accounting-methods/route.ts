import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CreateMethodBodySchema, RegisterQuerySchema, createAccountingMethod, getAccountingRegister } from '@/lib/annexe/methods/manage-accounting-methods.service'

/** GET /api/accounting-methods?companyId=&fiscalYearId=: the register of methods and the changes (of the fiscal year when given). */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: RegisterQuerySchema }, async ({ companyId, query }) =>
  NextResponse.json(await getAccountingRegister(companyId, query.fiscalYearId), { headers: NO_CACHE_HEADERS }),
)

/** POST /api/accounting-methods { companyId, topic, label, description, adoptedOn, referenceMethod }: a method of the register. 201. */
export const POST = companyRoute({ company: fromBody(), permission: { entries: ['create'] }, body: CreateMethodBodySchema }, async ({ companyId, body }) =>
  NextResponse.json(await createAccountingMethod(companyId, body), { status: 201 }),
)
