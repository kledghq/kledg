import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminRoute } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { writeAuditLog } from '@/lib/audit'
import { searchUsers } from '@/lib/rbac/manage-members.service'
import { CreateInstanceUserSchema } from '@/lib/users/schemas'
import { createInstanceUser } from '@/lib/users/instance-users.service'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const Query = z.object({
  search: z.string().trim().optional(),
  /** Company (id or slug) whose members are left out. */
  excludeCompanyId: z.string().trim().optional(),
  /** Clamped to 1..100; anything unreadable falls back to 20. */
  limit: z
    .string()
    .optional()
    .transform((value) => {
      const limit = Number.parseInt(value ?? '', 10)
      return Number.isNaN(limit) || limit < 1 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT)
    }),
})

/** Instance administrators only: users search (e.g. to add a member to a company). */
export const GET = adminRoute({ query: Query }, async ({ query }) =>
  NextResponse.json(
    await searchUsers({ search: query.search || undefined, excludeCompany: query.excludeCompanyId || undefined, limit: query.limit }),
  ),
)

/**
 * Instance administrators: creates a regular account (the "Nouveau compte"
 * page). Same origin only, rate limited, audited. Replaces Better Auth's
 * /admin/create-user, closed over HTTP (lib/auth-policy.ts).
 */
export const POST = adminRoute({ body: CreateInstanceUserSchema }, async ({ request, user, body }) => {
  assertSameOrigin(request)
  const created = await createInstanceUser(user, body)
  await writeAuditLog('info', 'Instance user created', { action: 'USER_CREATED', metadata: { userId: created.id, email: created.email } })
  return NextResponse.json(created, { status: 201 })
})
