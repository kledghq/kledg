import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { AccountQuerySchema, autoLetterAccount } from '@/lib/lettering/lettering.service'

/**
 * POST /api/lettering/auto { companyId, accountId }
 * Applies every automatic proposal of the account (auto-lettrage), each
 * with its own code.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['update'] }, body: AccountQuerySchema },
  async ({ companyId, body }) => NextResponse.json(await autoLetterAccount(companyId, body.accountId)),
)
