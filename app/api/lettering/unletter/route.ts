import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { UnletterBodySchema, unletterCode } from '@/lib/lettering/lettering.service'

/**
 * POST /api/lettering/unletter { companyId, accountId, code }
 * Removes a lettering code from every line of the account that carries it.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['update'] }, body: UnletterBodySchema },
  async ({ companyId, body }) => NextResponse.json(await unletterCode(companyId, body)),
)
