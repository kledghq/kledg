import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { listGrants } from '@/lib/ai-access/manage-grants.service'

/**
 * Company grants of the signed-in user's assistants and API keys. A
 * connection without a grant reaches every company (not listed here).
 */
export const GET = authedRoute({}, async ({ user }) => NextResponse.json(await listGrants(user.id)))
