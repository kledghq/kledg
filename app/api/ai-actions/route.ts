import { NextResponse } from 'next/server'
import { authedRoute } from '@/lib/api/route'
import { listActionsOfUser } from '@/lib/mcp/full-control/pending-actions'

/** GET /api/ai-actions: the user's actions prepared by assistants (waiting ones first in the page), with their preview. */
export const GET = authedRoute({}, async ({ user }) => NextResponse.json({ actions: await listActionsOfUser(user.id) }))
