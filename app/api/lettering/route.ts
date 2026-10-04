import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import {
  LetteringLinesQuerySchema,
  LetterLinesBodySchema,
  letterLines,
  listLetteringLines,
} from '@/lib/lettering/lettering.service'

/**
 * GET /api/lettering?companyId=&accountId=&status=open|lettered|all
 * Validated lines of a third-party account, oldest first, with a running
 * balance (lib/lettering/lettering.service.ts).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: LetteringLinesQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await listLetteringLines(companyId, query), { headers: NO_CACHE_HEADERS }),
)

/**
 * POST /api/lettering { companyId, accountId, lineIds }
 * Letters a balanced selection with the next code of the account. Lettering
 * only touches the lettering fields, so validated entries can be lettered.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['update'] }, body: LetterLinesBodySchema },
  async ({ companyId, body }) => NextResponse.json(await letterLines(companyId, body), { status: 201 }),
)
