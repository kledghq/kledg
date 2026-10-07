/**
 * Company grants of AI assistants (OAuth clients) and API keys.
 *
 * Invariant: a grant only narrows what its owner can already do. It names
 * companies the owner can access when it is saved; it never gives access on
 * its own (the MCP tools still check the owner's role in each company).
 *
 * Fail closed: a connection without a grant reaches no company. Every
 * connection gets its grant when it is made (the consent page saves the
 * assistant's grant before the consent, an API key is created with its
 * grant), and migration 20261011120000_explicit_ai_access gave the
 * connections made before grants existed an explicit "every company" grant,
 * which is what they had.
 *
 * A grant belongs to one user: it is read and written for the signed-in user
 * only, and an API key grant only for a key the user owns. Cleanup on
 * revocation and deletion is done by the database (see the
 * 20261005090000_ai_access_grants migration).
 */

import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import { COMPANY_NOT_FOUND_MESSAGE, isGlobalAdmin } from '@/lib/rbac/authorize'
import { NotFoundError } from '@/lib/accounting/errors'
import {
  ALL_COMPANIES,
  DEFAULT_EXECUTION_MODE,
  type AiAccessGrants,
  type CompanyAccess,
  type ConnectionAccess,
  type ExecutionMode,
} from '@/lib/ai-access/access'

/** What a grant applies to: an assistant authorized through OAuth, or an API key. */
export type GrantTarget = { kind: 'oauth'; clientId: string } | { kind: 'apiKey'; apiKeyId: string }

const ASSISTANT_NOT_FOUND_MESSAGE = 'Assistant introuvable'
const API_KEY_NOT_FOUND_MESSAGE = 'Clé API introuvable'

const GRANT_SELECT = {
  clientId: true,
  apiKeyId: true,
  allCompanies: true,
  executionMode: true,
  companies: { select: { companyId: true } },
} as const

/** No company at all: the access of a connection without a grant. */
const NO_COMPANIES: CompanyAccess = { allCompanies: false, companyIds: [] }

function toAccess(grant: { allCompanies: boolean; companies: { companyId: string }[] } | null): CompanyAccess {
  if (!grant) return NO_COMPANIES
  return grant.allCompanies
    ? ALL_COMPANIES
    : { allCompanies: false, companyIds: grant.companies.map((c) => c.companyId).sort() }
}

function targetWhere(userId: string, target: GrantTarget) {
  return target.kind === 'oauth' ? { userId, clientId: target.clientId } : { userId, apiKeyId: target.apiKeyId }
}

/** The access of one connection of `userId` (no company when no grant was saved). */
export async function getGrant(userId: string, target: GrantTarget): Promise<CompanyAccess> {
  return toAccess(await prisma.aiAccessGrant.findFirst({ where: targetWhere(userId, target), select: GRANT_SELECT }))
}

/** A stored mode, read fail closed: anything but 'automatic' asks for validation. */
export function executionModeOf(stored: string | null | undefined): ExecutionMode {
  return stored === 'automatic' ? 'automatic' : 'validation'
}

/**
 * How a connection of `userId` runs its high-impact full control tools. Read
 * on every MCP request (never copied into a token), so a change applies to
 * the next call. A connection without a grant reaches no company anyway; it
 * reads as 'validation' (fail closed).
 */
export async function getExecutionMode(userId: string, target: GrantTarget): Promise<ExecutionMode> {
  const grant = await prisma.aiAccessGrant.findFirst({ where: targetWhere(userId, target), select: { executionMode: true } })
  return executionModeOf(grant?.executionMode)
}

/**
 * Whether the "Actions IA à approuver" page is useful to the user: one of
 * their connections runs in validation mode, or an action still waits for
 * their decision (prepared before a switch to automatic).
 */
export async function approvalPageAvailable(userId: string, now: Date = new Date()): Promise<boolean> {
  const [validation, pending] = await Promise.all([
    prisma.aiAccessGrant.count({ where: { userId, executionMode: 'validation' } }),
    prisma.mcpPendingAction.count({ where: { userId, status: { in: ['pending', 'approved'] }, expiresAt: { gt: now } } }),
  ])
  return validation > 0 || pending > 0
}

/** Every saved grant of a user, for the settings page. */
export async function listGrants(userId: string): Promise<AiAccessGrants> {
  const grants = await prisma.aiAccessGrant.findMany({ where: { userId }, select: GRANT_SELECT, take: 500 })
  return {
    assistants: grants.flatMap((g) =>
      g.clientId ? [{ clientId: g.clientId, ...toAccess(g), executionMode: executionModeOf(g.executionMode) }] : [],
    ),
    apiKeys: grants.flatMap((g) =>
      g.apiKeyId ? [{ apiKeyId: g.apiKeyId, ...toAccess(g), executionMode: executionModeOf(g.executionMode) }] : [],
    ),
  }
}

/**
 * Checks that the user can access every company of the list. A company the
 * user cannot see answers like a missing one (404), so ids are never confirmed.
 */
async function assertCompaniesAccessible(user: CurrentUser, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return
  const found = await prisma.company.count({
    where: {
      id: { in: companyIds },
      ...(isGlobalAdmin(user) ? {} : { organization: { members: { some: { userId: user.id } } } }),
    },
  })
  if (found !== companyIds.length) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
}

/** The target must exist and, for an API key, belong to the user. Otherwise 404. */
async function assertTargetOwned(user: CurrentUser, target: GrantTarget): Promise<void> {
  if (target.kind === 'oauth') {
    const client = await prisma.oauthClient.findUnique({ where: { clientId: target.clientId }, select: { id: true } })
    if (!client) throw new NotFoundError(ASSISTANT_NOT_FOUND_MESSAGE)
    return
  }
  const key = await prisma.apikey.findFirst({
    where: { id: target.apiKeyId, referenceId: user.id },
    select: { id: true },
  })
  if (!key) throw new NotFoundError(API_KEY_NOT_FOUND_MESSAGE)
}


/**
 * Saves the access of one connection of `user`, replacing the previous one.
 * `executionMode` is kept when not given (a new grant starts 'automatic').
 * Applies to the next MCP call: the grant is read on every tool call, never
 * copied into a token.
 */
export async function setGrant(
  user: CurrentUser,
  target: GrantTarget,
  access: CompanyAccess,
  executionMode?: ExecutionMode,
): Promise<ConnectionAccess> {
  await assertTargetOwned(user, target)
  const companyIds = access.allCompanies ? [] : [...new Set(access.companyIds)]
  await assertCompaniesAccessible(user, companyIds)

  const saved = await prisma.$transaction(async (tx) => {
    const update = { allCompanies: access.allCompanies, ...(executionMode && { executionMode }) }
    const create = { allCompanies: access.allCompanies, executionMode: executionMode ?? DEFAULT_EXECUTION_MODE }
    const grant =
      target.kind === 'oauth'
        ? await tx.aiAccessGrant.upsert({
            where: { userId_clientId: { userId: user.id, clientId: target.clientId } },
            create: { userId: user.id, clientId: target.clientId, ...create },
            update,
            select: { id: true, executionMode: true },
          })
        : await tx.aiAccessGrant.upsert({
            where: { apiKeyId: target.apiKeyId },
            create: { userId: user.id, apiKeyId: target.apiKeyId, ...create },
            update,
            select: { id: true, executionMode: true },
          })
    await tx.aiAccessGrantCompany.deleteMany({ where: { grantId: grant.id } })
    if (companyIds.length > 0) {
      await tx.aiAccessGrantCompany.createMany({ data: companyIds.map((companyId) => ({ grantId: grant.id, companyId })) })
    }
    return grant
  })

  const mode = executionModeOf(saved.executionMode)
  return access.allCompanies
    ? { ...ALL_COMPANIES, executionMode: mode }
    : { allCompanies: false, companyIds: companyIds.sort(), executionMode: mode }
}
