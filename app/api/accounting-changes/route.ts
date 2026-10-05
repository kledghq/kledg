import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { CreateChangeBodySchema, createAccountingChange } from '@/lib/annexe/methods/manage-accounting-methods.service'

/**
 * POST /api/accounting-changes { companyId, fiscalYearId, kind, treatment, label, description, impactCents, ... }:
 * a change of method, regulation or estimate, or a correction of error (PCG art. 122-1 to 122-6). 201.
 */
export const POST = companyRoute({ company: fromBody(), permission: { entries: ['create'] }, body: CreateChangeBodySchema }, async ({ companyId, body }) =>
  NextResponse.json(await createAccountingChange(companyId, body), { status: 201 }),
)
