import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody } from '@/lib/api/route'
import { attachAuxiliaryAccounts } from '@/lib/tiers/attach-auxiliary-accounts.service'

/**
 * POST /api/tiers/attach-auxiliary { companyId }
 * Creates the tiers of the auxiliary account numbers already used on 40 and
 * 41 lines, without changing any posted line (idempotent).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: z.object({ companyId: z.string() }) },
  async ({ companyId }) => NextResponse.json(await attachAuxiliaryAccounts(companyId)),
)
