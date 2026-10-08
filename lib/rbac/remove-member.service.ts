/**
 * Removing a member from a company, or leaving it
 * (docs/membres-et-invitations.md).
 *
 * Who may remove whom is lib/rbac/member-removal-rules.ts: a member with
 * members:manage removes a member holding no right they lack, never an
 * instance administrator, never the last member able to manage the members;
 * anyone leaves unless they are that last one; an instance administrator
 * removes anyone. The instance policy may refuse it ('remove-member').
 *
 * The removal ends the person's access at once, in one transaction:
 * - their membership rows of the company are deleted (every request,
 *   MCP call and row level security policy reads them on each statement,
 *   so their sessions, API keys and assistants lose the company at once);
 * - their sessions whose active organization was this company's lose it;
 * - their assistants' and API keys' grants on this company are deleted
 *   (lib/ai-access): being added back never revives an old grant;
 * - their AI actions of this company waiting for approval, or approved and
 *   not run yet, are cancelled (status rejected);
 * - the invitations they sent to this company and still open are revoked:
 *   their authority ends with their access.
 * What they recorded (entries, expense reports, audit entries) stays and
 * keeps their name: the user account is never deleted.
 *
 * The decision and the writes run under an advisory lock of the company's
 * members, so two administrators removing each other cannot both succeed
 * and leave nobody to manage the company. The writes run in the system
 * context 'member-removal' (docs/rls.md): a membership, the grants and the
 * pending actions of another user are rows only an unrestricted context
 * writes. The caller's rights were checked first, in their own context.
 * Rate limited per user acting, audited (MEMBER_REMOVED); the person
 * removed by someone else gets an email notice when emails are sent.
 */

import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { getAppUrl } from '@/lib/config'
import { isEmailEnabled, sendEmail } from '@/lib/email'
import { memberRemovedEmail } from '@/lib/email/templates'
import { actionRefusalMessage, assertActionAllowed, isActionAllowed } from '@/lib/instance'
import { logger } from '@/lib/logger'
import { enforceRateLimit } from '@/lib/rate-limit'
import { withSystemContext } from '@/lib/rls/context'
import { checkApprovedTargets } from '@/lib/approved-state/guard'
import { runAfterCommit } from '@/lib/approved-state/ambient'
import { assertCompanyWritable } from '@/lib/companies/archive-company.service'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/accounting/errors'
import { grantedPermissions } from './granted-permissions'
import { LAST_MANAGER_MESSAGE, LAST_MANAGER_SELF_MESSAGE, managesMembers, removalRefusal, type RemovalSubject } from './member-removal-rules'

const MEMBER_NOT_FOUND_MESSAGE = 'Membre introuvable'
export const NOT_A_MEMBER_MESSAGE = "Vous n'êtes pas membre de cette société."

/** The user acting, as routes and MCP tools know it. */
export interface RemovalActorUser {
  id: string
  email: string
  name?: string | null
  role: string | null
}

function rolesOf(role: string): string[] {
  return role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
}

interface MemberRow {
  id: string
  userId: string
  role: string
  user: { email: string; name: string | null; role: string | null; banned: boolean | null }
}

/** The members of the company with their account, every membership row of each user merged. */
function subjectsOf(rows: MemberRow[]): Map<string, RemovalSubject & { banned: boolean }> {
  const byUser = new Map<string, RemovalSubject & { banned: boolean }>()
  for (const row of rows) {
    const current = byUser.get(row.userId)
    const roles = [...(current?.roles ?? []), ...rolesOf(row.role)]
    byUser.set(row.userId, { userId: row.userId, roles, isInstanceAdmin: row.user.role === 'admin', banned: Boolean(row.user.banned) })
  }
  return byUser
}

/** Members other than `userId` who can manage the members (a banned account cannot). */
function otherManagersOf(subjects: Map<string, RemovalSubject & { banned: boolean }>, userId: string): number {
  return [...subjects.values()].filter((s) => s.userId !== userId && !s.banned && managesMembers(s)).length
}

function actorOf(user: RemovalActorUser, subjects: Map<string, RemovalSubject & { banned: boolean }>) {
  const isInstanceAdmin = user.role === 'admin'
  const roles = subjects.get(user.id)?.roles ?? []
  return { userId: user.id, isInstanceAdmin, permissions: grantedPermissions([...roles], isInstanceAdmin) }
}

const MEMBER_SELECT = {
  id: true,
  userId: true,
  role: true,
  user: { select: { email: true, name: true, role: true, banned: true } },
} as const

/** A member of the Membres page, with whether the user looking may remove them, and why not. */
export interface MemberWithRemoval {
  id: string
  userId: string
  email: string
  name: string | null
  roles: string[]
  createdAt: Date | null
  /** The member is the user looking (their action is "Quitter la société"). */
  self: boolean
  removal: { allowed: true } | { allowed: false; reason: string }
}

/**
 * The members of the company, oldest first, each with the answer the
 * removal would get from `viewer` now (the page disables "Retirer" with the
 * reason). The removal checks it again under its lock. When the instance
 * policy refuses 'remove-member' to `viewer`, every removal, leaving
 * included, is refused with the policy's message, so the page shows
 * "Retirer" and "Quitter" disabled instead of failing on click.
 */
export async function listMembersWithRemoval(companyId: string, viewer: RemovalActorUser): Promise<MemberWithRemoval[]> {
  const policyRefusal = (await isActionAllowed('remove-member', { id: viewer.id, email: viewer.email, role: viewer.role }))
    ? null
    : actionRefusalMessage('remove-member')
  const rows = await prisma.member.findMany({
    where: { organization: { companyId } },
    select: { ...MEMBER_SELECT, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  const subjects = subjectsOf(rows)
  const actor = actorOf(viewer, subjects)
  return rows.map((row) => {
    const subject = subjects.get(row.userId) ?? { userId: row.userId, roles: [], isInstanceAdmin: false, banned: false }
    const reason = policyRefusal ?? removalRefusal(actor, subject, otherManagersOf(subjects, row.userId))
    return {
      id: row.id,
      userId: row.userId,
      email: row.user.email,
      name: row.user.name,
      roles: rolesOf(row.role),
      createdAt: row.createdAt,
      self: row.userId === viewer.id,
      removal: reason === null ? { allowed: true } : { allowed: false, reason },
    }
  })
}

export interface RemoveMemberInput {
  companyId: string
  /** The membership removed; for leaving, the actor's own (see leaveCompany). */
  memberId: string
  actor: RemovalActorUser
  /** Email the person removed (never when they leave themselves). Default true. */
  notify?: boolean
  /** 'mcp' when an assistant removes the member, for the audit entry. */
  source?: 'mcp'
  now?: Date
}

export interface RemoveMemberResult {
  memberId: string
  userId: string
  email: string
  name: string | null
  role: string
  /** The actor left the company themselves. */
  self: boolean
  /** Assistant or API key grants of the company deleted. */
  revokedGrants: number
  /** AI actions of the company cancelled (waiting for approval, or approved and not run). */
  cancelledActions: number
  /** Open invitations they had sent to the company, revoked. */
  revokedInvitations: number
  /** The notice email left (false when emails are not sent, or when they left themselves). */
  emailSent: boolean
}

/** Removes the member `memberId` from the company, under the rules above. Audited (MEMBER_REMOVED). */
export async function removeCompanyMember(input: RemoveMemberInput): Promise<RemoveMemberResult> {
  const now = input.now ?? new Date()
  const { companyId, actor } = input
  await assertActionAllowed('remove-member', { id: actor.id, email: actor.email, role: actor.role })
  await assertCompanyWritable(companyId)
  await enforceRateLimit('member-removal', actor.id)

  const removed = await withSystemContext('member-removal', () =>
    prisma.$transaction(async (tx) => {
      // One removal at a time per company: the "last manager" count holds until the commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:company-members:${companyId}`}))`
      // An approved MCP action: the member row and the company as the user approved them.
      await checkApprovedTargets(tx)
      const organization = await tx.organization.findUnique({ where: { companyId }, select: { id: true } })
      const target = organization
        ? await tx.member.findFirst({ where: { id: input.memberId, organizationId: organization.id }, select: MEMBER_SELECT })
        : null
      if (!organization || !target) throw new NotFoundError(MEMBER_NOT_FOUND_MESSAGE)

      const rows = await tx.member.findMany({ where: { organizationId: organization.id }, select: MEMBER_SELECT })
      const subjects = subjectsOf(rows)
      const subject = subjects.get(target.userId) ?? { userId: target.userId, roles: rolesOf(target.role), isInstanceAdmin: target.user.role === 'admin', banned: false }
      const refusal = removalRefusal(actorOf(actor, subjects), subject, otherManagersOf(subjects, target.userId))
      if (refusal === LAST_MANAGER_MESSAGE || refusal === LAST_MANAGER_SELF_MESSAGE) throw new ConflictError(refusal)
      if (refusal) throw new ForbiddenError(refusal)

      const userId = target.userId
      await tx.member.deleteMany({ where: { organizationId: organization.id, userId } })
      await tx.session.updateMany({ where: { userId, activeOrganizationId: organization.id }, data: { activeOrganizationId: null } })
      const grants = await tx.aiAccessGrantCompany.deleteMany({ where: { companyId, grant: { userId } } })
      const actions = await tx.mcpPendingAction.updateMany({
        where: { userId, companyId, status: { in: ['pending', 'approved'] } },
        data: { status: 'rejected', decidedAt: now },
      })
      const invitations = await tx.companyInvitation.updateMany({
        where: { companyId, invitedById: userId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      })
      return {
        memberId: target.id,
        userId,
        email: target.user.email,
        name: target.user.name,
        role: subject.roles.join(','),
        self: userId === actor.id,
        revokedGrants: grants.count,
        cancelledActions: actions.count,
        revokedInvitations: invitations.count,
      }
    }),
  )

  // The removal is committed: a notice that fails is logged, it never fails the request nor skips the audit entry.
  let emailSent = false
  if (!removed.self && input.notify !== false) {
    try {
      if (await isEmailEnabled()) {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
        const message = memberRemovedEmail(removed.email, { companyName: company?.name ?? 'la société', removedByName: actor.name?.trim() || actor.email }, getAppUrl())
        await runAfterCommit(async () => {
          try {
            await sendEmail(message)
            emailSent = true
          } catch (error) {
            logger.error("Avis de retrait d'un membre non envoyé", { error })
          }
        })
      }
    } catch (error) {
      logger.error("Avis de retrait d'un membre non envoyé", { error })
    }
  }

  // As the system too: a member who left reaches the company no more, so
  // their own context could not write its audit entry (docs/rls.md).
  await withSystemContext('member-removal', () => writeAuditLog('info', removed.self ? 'Membre parti de la société' : 'Membre retiré de la société', {
    action: 'MEMBER_REMOVED',
    companyId,
    metadata: {
      memberId: removed.memberId,
      userId: removed.userId,
      email: removed.email,
      name: removed.name,
      role: removed.role,
      removedById: actor.id,
      self: removed.self,
      revokedGrants: removed.revokedGrants,
      cancelledActions: removed.cancelledActions,
      revokedInvitations: removed.revokedInvitations,
      emailSent,
      ...(input.source && { source: input.source }),
    },
  }))
  return { ...removed, emailSent }
}

/** The actor leaves the company ("Quitter la société"): their own membership, under the same rules. */
export async function leaveCompany(input: Omit<RemoveMemberInput, 'memberId' | 'notify'>): Promise<RemoveMemberResult> {
  const own = await prisma.member.findFirst({
    where: { userId: input.actor.id, organization: { companyId: input.companyId } },
    select: { id: true },
  })
  if (!own) throw new NotFoundError(NOT_A_MEMBER_MESSAGE)
  return removeCompanyMember({ ...input, memberId: own.id, notify: false })
}
