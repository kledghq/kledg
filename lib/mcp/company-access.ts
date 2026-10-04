/**
 * The one place where MCP tools check access to a company.
 *
 * A tool may touch a company only if both hold, checked on every call:
 * - the user's role in the company grants the tool's permission (same rule
 *   as the web UI, lib/rbac/authorize.ts);
 * - the connection (OAuth client or API key) was granted that company
 *   (lib/ai-access). An OAuth connection whose consent was revoked reaches
 *   no company at all, even while its access token has not expired.
 *
 * A company outside the grant answers exactly like a company the user is not
 * a member of ("Société introuvable"), so the existence of other companies is
 * never confirmed. Objects of a company (fiscal years, entries, accounts,
 * transactions) are always looked up with the granted companyId in the
 * query, so an id from another company is not found either.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import {
  COMPANY_NOT_FOUND_MESSAGE,
  isGlobalAdmin,
  requireCompanyPermission,
  type Permission,
} from '@/lib/rbac/authorize'
import { ForbiddenError, NotFoundError } from '@/lib/accounting/errors'
import { getGrant } from '@/lib/ai-access/manage-grants.service'
import type { ExecutionMode } from '@/lib/ai-access/access'
import { assertCompanyWritable } from '@/lib/companies/archive-company.service'

/** Whether a permission only reads (every action is 'read'): allowed on an archived company. */
function readsOnly(permission: Permission): boolean {
  return Object.values(permission).every((actions) => (actions ?? []).every((action) => action === 'read'))
}

/** Who is calling: an assistant authorized through OAuth (its client id) or an API key (its id). */
export type McpCaller = { kind: 'oauth'; clientId: string } | { kind: 'apiKey'; apiKeyId: string }

/** The OAuth client of a verified access token (Better Auth sets both client_id and azp). */
export function clientIdOf(claims: Record<string, unknown>): string | null {
  const value = claims.client_id ?? claims.azp
  return typeof value === 'string' && value ? value : null
}

export interface McpAccess {
  user: CurrentUser
  /** Whether the client may create draft entries (kledg:write or kledg:admin, in the token and the consent; API key level). */
  canWrite: boolean
  /**
   * Full control (kledg:admin in the token and the consent, or an API key
   * created with that level): tools that act like the user beyond drafts
   * (validate, reconcile, import, close). Register them only when true and
   * check them with `CompanyGuard.requireFullControl`.
   */
  canAdmin: boolean
  caller: McpCaller
  /**
   * How full control runs high-impact tools for this connection, read from
   * its grant at the start of the request (lib/ai-access/access.ts,
   * ExecutionMode): 'automatic' executes on the call, 'validation' needs the
   * user's approval in Kledg first.
   */
  executionMode: ExecutionMode
}

/** Companies a connection may reach, before the user's roles are checked. */
export type CompanyScope = { all: true } | { all: false; companyIds: ReadonlySet<string> }

const NO_COMPANY: CompanyScope = { all: false, companyIds: new Set() }

/**
 * Scopes the user currently consents to for an OAuth client, or null once the
 * assistant was revoked. Read on every call (indexed on userId, clientId):
 * JWT access tokens are stateless, so this is what makes a revocation or a
 * lowered access level apply before they expire.
 */
export async function findConsentScopes(userId: string, clientId: string): Promise<string[] | null> {
  const consent = await prisma.oauthConsent.findFirst({
    where: { userId, clientId },
    select: { scopes: true },
  })
  return consent ? consent.scopes : null
}

/** Reads the grant of the caller now (never cached: a change applies to the next call). */
export async function loadCompanyScope(userId: string, caller: McpCaller): Promise<CompanyScope> {
  if (caller.kind === 'oauth') {
    // Revoking an assistant deletes its consent (and its grant). Its access
    // token stays valid until it expires: it must not fall back to "every company".
    if (!(await findConsentScopes(userId, caller.clientId))) return NO_COMPANY
  }
  const access = await getGrant(userId, caller)
  return access.allCompanies ? { all: true } : { all: false, companyIds: new Set(access.companyIds) }
}

export interface CompanyGuard {
  /**
   * Throws "Société introuvable" (404) when the company is outside the grant
   * or the user is not a member, 403 when the user's role lacks `permission`.
   */
  require(companyId: string, permission: Permission): Promise<void>
  /**
   * The guard of full control tools: refuses (403) a connection without
   * kledg:admin, then applies `require` (grant, membership, role). Full
   * control never exceeds the user's own role in the company.
   */
  requireFullControl(companyId: string, permission: Permission): Promise<void>
  /** Filter of the companies the caller may list: the user's companies within the grant. */
  companyWhere(): Promise<Prisma.CompanyWhereInput>
}

export const FULL_CONTROL_REQUIRED_MESSAGE =
  "Cette action demande le contrôle total. Reconnectez l'assistant et choisissez Contrôle total, ou utilisez une clé API de ce niveau."

export function companyGuard({ user, caller, canAdmin }: McpAccess): CompanyGuard {
  async function require(companyId: string, permission: Permission) {
    const scope = await loadCompanyScope(user.id, caller)
    if (!scope.all && !scope.companyIds.has(companyId)) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
    await requireCompanyPermission(user, companyId, permission)
    // An archived company is read-only for assistants too.
    if (!readsOnly(permission)) await assertCompanyWritable(companyId)
  }
  return {
    require,
    async requireFullControl(companyId, permission) {
      if (!canAdmin) throw new ForbiddenError(FULL_CONTROL_REQUIRED_MESSAGE)
      await require(companyId, permission)
    },
    async companyWhere() {
      const scope = await loadCompanyScope(user.id, caller)
      // Archived companies are hidden from lists (lib/companies/archive-company.service.ts).
      const member: Prisma.CompanyWhereInput = isGlobalAdmin(user)
        ? { archivedAt: null }
        : { archivedAt: null, organization: { members: { some: { userId: user.id } } } }
      return scope.all ? member : { AND: [member, { id: { in: [...scope.companyIds] } }] }
    },
  }
}
