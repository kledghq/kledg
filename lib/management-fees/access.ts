/**
 * Cross-company access of management fees: the one place where the feature
 * reaches a company other than the holding of the request.
 *
 * Invariants owned here:
 * - every company touched (the holding and each subsidiary) is checked with
 *   the user's own role there, with the permission of what is done there:
 *   reading a subsidiary's revenue needs reports:read in the subsidiary,
 *   proposing a purchase invoice to it needs entries:create in it. Being a
 *   member of the holding gives nothing in a subsidiary (never write in a
 *   company only because its id was sent);
 * - the check runs through a `GroupAccess`: the web routes build it from
 *   the user's roles (userGroupAccess), the MCP tools from their company
 *   guard (lib/mcp/company-access.ts), which also applies the connection's
 *   company grant, so an assistant never reaches a subsidiary it was not
 *   granted;
 * - lookups across companies run narrowed explicitly: to the access's own
 *   bound (an assistant's grant) to find the subsidiaries, then to the
 *   holding and those subsidiaries (lib/management-fees/holding.ts);
 * - the work in a subsidiary runs in that subsidiary's own row level
 *   security scope (withUserContext narrowed to it, docs/rls.md): the
 *   database still decides from the user's memberships, so a forgotten check
 *   reaches nothing, and no system context is ever used.
 *
 * The context of a transaction is the one active when it starts
 * (lib/rls/context.ts): never call inCompany inside a $transaction callback.
 */

import { ForbiddenError, NotFoundError } from '@/lib/accounting/errors'
import { assertCompanyWritable } from '@/lib/companies/archive-company.service'
import { prisma } from '@/lib/prisma'
import { requireCompanyPermission, type Permission } from '@/lib/rbac/authorize'
import { withUserContext } from '@/lib/rls/context'
import type { CurrentUser } from '@/lib/session'

export interface GroupAccess {
  userId: string
  /**
   * Throws a 404 when the company is out of reach (not a member, outside an
   * assistant's grant) and a 403 when the user's role there lacks
   * `permission`; refuses writes on an archived company.
   */
  require(companyId: string, permission: Permission): Promise<void>
  /**
   * The most companies this access reaches, when it is narrower than the
   * user's memberships (an assistant's company grant); absent or null: every
   * company of the user. Lookups across companies (the subsidiary candidates)
   * never run wider than this.
   */
  companyIds?(): Promise<readonly string[] | null>
}

/** Whether a permission only reads (every action is 'read'): allowed on an archived company. */
function readsOnly(permission: Permission): boolean {
  return Object.values(permission).every((actions) => (actions ?? []).every((action) => action === 'read'))
}

/** Access of a signed-in user of the web app: their role in each company. */
export function userGroupAccess(user: CurrentUser): GroupAccess {
  return {
    userId: user.id,
    async require(companyId, permission) {
      await requireCompanyPermission(user, companyId, permission)
      if (!readsOnly(permission)) await assertCompanyWritable(companyId)
    },
  }
}

export const SUBSIDIARY_OUT_OF_REACH =
  'Une filiale de la convention n’est pas accessible avec votre compte : demandez à être membre de cette société, ou retirez-la de la convention.'

/**
 * Runs `fn` in the row level security scope of `companyId` (a subsidiary),
 * after checking `permission` there. A subsidiary out of reach answers a 404
 * that names no company; a role too low answers a 403 naming the
 * subsidiary (the user is a member of it).
 */
export function inCompany<T>(access: GroupAccess, companyId: string, permission: Permission, fn: () => Promise<T>): Promise<T> {
  return withUserContext(
    access.userId,
    async () => {
      try {
        await access.require(companyId, permission)
      } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError(SUBSIDIARY_OUT_OF_REACH)
        if (error instanceof ForbiddenError) {
          const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
          throw new ForbiddenError(`${company?.name ?? 'Filiale'} : ${error.message}`)
        }
        throw error
      }
      return fn()
    },
    { companyIds: [companyId] },
  )
}
