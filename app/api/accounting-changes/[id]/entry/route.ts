import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfAccountingChange } from '@/lib/api/resources'
import { prepareAccountingChangeEntry } from '@/lib/annexe/methods/manage-accounting-methods.service'

/** POST /api/accounting-changes/[id]/entry: prepares the catch-up entry as a draft (nothing validated). Idempotent. */
export const POST = companyRoute({ company: fromResource(companyOfAccountingChange), permission: { entries: ['create'] } }, async ({ companyId, params }) =>
  NextResponse.json(await prepareAccountingChangeEntry(companyId, params.id as string), { status: 201 }),
)
