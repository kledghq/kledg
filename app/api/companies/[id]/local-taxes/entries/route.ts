import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { CfeEntryBodySchema, prepareCfeEntry } from '@/lib/local-taxes/prepare-cfe-entry.service'
import { LOCAL_TAXES_WRITE } from '@/lib/local-taxes/permissions'

/**
 * POST /api/companies/[id]/local-taxes/entries { year, kind: 'acompte' | 'solde', counterpart?: 'bank' | 'payable' }:
 * prepares the CFE payment (63511 / 512) or charge (63511 / 447) as a DRAFT, never validated. Idempotent: a
 * matching draft is kept, a stale one replaced, a validated entry left alone.
 */
export const POST = companyRoute(
  { company: fromParam(), permission: LOCAL_TAXES_WRITE, body: CfeEntryBodySchema },
  async ({ companyId, body }) => {
    const result = await prepareCfeEntry(companyId, body)
    return NextResponse.json(result, { status: result.status === 'created' || result.status === 'replaced' ? 201 : 200 })
  },
)
