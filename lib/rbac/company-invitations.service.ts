/**
 * Invitations of a company (GitHub issue #13, docs/membres-et-invitations.md).
 *
 * A member who may manage the members of a company (members:manage, the
 * company administrators, and instance administrators) invites a person by
 * email with a company role. Invariants:
 * - the role is a company role (companyAdmin, accountant, viewer), never
 *   the instance administrator role, and grants nothing the inviter's own
 *   roles in that company do not grant (grantableRoles);
 * - the instance policy may refuse invitations ('invite-member', checked on
 *   every send and again at acceptance) and the creation of an account from
 *   an invitation ('invitation-sign-up': then only an existing account can
 *   accept);
 * - the emailed link carries a random 256-bit token; only its SHA-256 is
 *   stored, so the table never holds a usable link. It expires after
 *   INVITATION_TTL_DAYS days, is single use (acceptedAt is set once, by a
 *   conditional update), and sending it again replaces the token;
 * - at most one open invitation per company and address (advisory lock);
 * - only the account of the invited address accepts: signed in with that
 *   address (confirmed), or created from the link (the link proves the
 *   mailbox; an unconfirmed account of that address is reset first, like
 *   KLEDG-SEC-011);
 * - a read-only company (archived, or refused writes by the instance
 *   policy) neither sends nor accepts invitations;
 * - sends are rate limited per inviter and per invited address, acceptance
 *   per client IP (by the page);
 * - every send, resend, revocation and acceptance writes an audit entry of
 *   the company.
 *
 * Row level security (docs/rls.md): company_invitations is a company table.
 * The acceptance runs in the system context 'invitation-acceptance': the
 * invitee is not a member yet, may have no session, and a membership is a
 * write only unrestricted contexts make.
 */

import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { getAppUrl } from '@/lib/config'
import { writeAuditLog } from '@/lib/audit'
import { isEmailEnabled, sendEmail } from '@/lib/email'
import { companyInvitationEmail } from '@/lib/email/templates'
import { assertActionAllowed, isActionAllowed, type InstanceActor } from '@/lib/instance'
import { enforceRateLimit } from '@/lib/rate-limit'
import { withSystemContext } from '@/lib/rls/context'
import { ROLE_LABELS } from '@/lib/permissions'
import { grantedPermissions, grants } from '@/lib/rbac/granted-permissions'
import type { Permission } from '@/lib/rbac/authorize'
import { assertCompanyWritable } from '@/lib/companies/archive-company.service'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { COMPANY_ROLES, resetUnconfirmedAccount, type CompanyRoleName } from './add-member-to-company.service'
import { ensureCompanyOrganization } from './ensure-company-organization.service'
import { formatDateShort } from '@/lib/utils/date'
import { inAmbientTransaction, runAfterCommit } from '@/lib/approved-state/ambient'

/** Days an invitation link stays valid. */
export const INVITATION_TTL_DAYS = 7
const DAY_MS = 86_400_000

/** Shape of a token: 32 random bytes in base64url. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/

export const INVITATION_NOT_FOUND_MESSAGE = 'Invitation introuvable.'
export const ROLE_ABOVE_INVITER_MESSAGE =
  'Vous ne pouvez pas donner un rôle qui a plus de droits que le vôtre dans cette société.'
export const ALREADY_MEMBER_MESSAGE = 'Cette personne est déjà membre de la société.'
export const INVITATION_PENDING_MESSAGE =
  'Une invitation est déjà en attente pour cette adresse : renvoyez-la depuis la liste des invitations.'
export const INVITATION_UNUSABLE_MESSAGE =
  "Cette invitation n'est plus valable : demandez à l'administrateur de la société de vous l'envoyer de nouveau."
export const WRONG_ACCOUNT_MESSAGE =
  "Cette invitation est adressée à une autre adresse email : connectez-vous avec le compte de cette adresse pour l'accepter."
export const ACCOUNT_EXISTS_MESSAGE =
  "Un compte existe déjà pour cette adresse : connectez-vous pour accepter l'invitation."
export const SIGN_UP_REFUSED_MESSAGE =
  "Sur cette instance, votre compte doit d'abord être créé par l'administrateur de l'instance. Une fois votre compte créé, rouvrez ce lien pour accepter l'invitation."

/** The user acting, as the routes and MCP tools know it. */
export interface InvitationActor {
  id: string
  email: string
  name?: string | null
  role: string | null
}

const actorOf = (user: InvitationActor): InstanceActor => ({ id: user.id, email: user.email, role: user.role })

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token) }
}

/** The acceptance page of a token. */
export function invitationUrl(token: string): string {
  return `${getAppUrl()}/invitation/${token}`
}

/**
 * Company roles that `inviterRoles` (the inviter's roles in the company) may
 * give: those granting nothing the inviter lacks. Every company role for an
 * instance administrator; never the instance administrator role.
 */
export function grantableRoles(inviterRoles: readonly string[], isInstanceAdmin: boolean): CompanyRoleName[] {
  const own = grantedPermissions([...inviterRoles], isInstanceAdmin)
  return COMPANY_ROLES.filter((role) => grants(own, grantedPermissions([role], false)))
}

/**
 * Whether the inviter holds `permission` in the company: the route's `can`
 * (companyRoute) or the MCP tool's (FullControlContext), which both read the
 * inviter's roles there (every right for an instance administrator).
 */
export type InviterCan = (permission: Permission) => boolean | Promise<boolean>

/** A company role whose every right the inviter also holds; never the instance administrator role. */
async function assertGrantable(role: string, inviterCan: InviterCan): Promise<void> {
  if (!COMPANY_ROLES.includes(role as CompanyRoleName)) throw new ValidationError('Rôle invalide.')
  if (!(await inviterCan(grantedPermissions([role], false) as Permission))) throw new ForbiddenError(ROLE_ABOVE_INVITER_MESSAGE)
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new ValidationError('Email invalide.')
  return email
}

function expiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * DAY_MS)
}

/** An invitation as the Membres page and the MCP tool list it (never its token). */
export interface InvitationSummary {
  id: string
  email: string
  role: string
  expiresAt: Date
  expired: boolean
  lastSentAt: Date
  sendCount: number
  createdAt: Date
  invitedBy: { name: string | null; email: string } | null
}

const SUMMARY_SELECT = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  lastSentAt: true,
  sendCount: true,
  createdAt: true,
  invitedById: true,
} as const

async function summarize(
  rows: Array<{ id: string; email: string; role: string; expiresAt: Date; lastSentAt: Date; sendCount: number; createdAt: Date; invitedById: string | null }>,
  now: Date,
): Promise<InvitationSummary[]> {
  const inviterIds = [...new Set(rows.map((r) => r.invitedById).filter((id): id is string => Boolean(id)))]
  const inviters = inviterIds.length
    ? await prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true, email: true } })
    : []
  const byId = new Map(inviters.map((u) => [u.id, { name: u.name, email: u.email }]))
  return rows.map(({ invitedById, ...row }) => ({
    ...row,
    expired: row.expiresAt.getTime() <= now.getTime(),
    invitedBy: invitedById ? (byId.get(invitedById) ?? null) : null,
  }))
}

/** Open invitations of the company (neither accepted nor revoked), expired ones flagged, newest first. */
export async function listInvitations(companyId: string, now: Date = new Date()): Promise<InvitationSummary[]> {
  const rows = await prisma.companyInvitation.findMany({
    where: { companyId, acceptedAt: null, revokedAt: null },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'desc' },
  })
  return summarize(rows, now)
}

async function sendInvitationEmail(
  invitation: { companyId: string; email: string; role: string; expiresAt: Date },
  token: string,
  inviter: InvitationActor,
): Promise<{ emailSent: boolean; link?: string }> {
  const company = await prisma.company.findUnique({ where: { id: invitation.companyId }, select: { name: true } })
  const url = invitationUrl(token)
  await sendEmail(
    companyInvitationEmail(
      invitation.email,
      {
        companyName: company?.name ?? 'la société',
        inviterName: inviter.name?.trim() || inviter.email,
        roleLabel: ROLE_LABELS[invitation.role] ?? invitation.role,
        expiresOn: formatDateShort(invitation.expiresAt),
      },
      url,
    ),
  )
  // Without email delivery (no RESEND_API_KEY, or refused by the instance) the
  // link is only in the server log: the inviter gets it to pass it on.
  return (await isEmailEnabled()) ? { emailSent: true } : { emailSent: false, link: url }
}

/**
 * The invitation email of an approved MCP action, sent after its commit
 * (runAfterCommit). The result is known now: the link only when no email
 * can carry it. A send that fails after the commit is logged; the inviter
 * sees the invitation pending and can resend it.
 */
async function deferredInvitationEmail(
  invitation: { companyId: string; email: string; role: string; expiresAt: Date },
  token: string,
  inviter: InvitationActor,
): Promise<{ emailSent: boolean; link?: string }> {
  const emailEnabled = await isEmailEnabled()
  await runAfterCommit(async () => {
    await sendInvitationEmail(invitation, token, inviter)
  })
  return emailEnabled ? { emailSent: true } : { emailSent: false, link: invitationUrl(token) }
}

export interface InviteInput {
  companyId: string
  email: string
  role: string
  inviter: InvitationActor
  /** Whether the inviter holds a right in the company (a role is grantable when they hold all its rights). */
  inviterCan: InviterCan
  /** 'mcp' when an assistant sends it, for the audit entry. */
  source?: 'mcp'
  now?: Date
}

export interface InviteResult {
  invitation: InvitationSummary
  emailSent: boolean
  /** The link, only when no email could carry it. */
  link?: string
}

/** Invites `email` into the company with `role`. Audited (MEMBER_INVITED). */
export async function inviteMember(input: InviteInput): Promise<InviteResult> {
  const now = input.now ?? new Date()
  await assertActionAllowed('invite-member', actorOf(input.inviter))
  await assertGrantable(input.role, input.inviterCan)
  const email = normalizeEmail(input.email)
  await assertCompanyWritable(input.companyId)

  const member = await prisma.member.findFirst({
    where: { organization: { companyId: input.companyId }, user: { email } },
    select: { id: true },
  })
  if (member) throw new ConflictError(ALREADY_MEMBER_MESSAGE)

  await enforceRateLimit('member-invitation', input.inviter.id)
  await enforceRateLimit('invitation-email', email)

  const { token, tokenHash } = newToken()
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:company-invitation:${input.companyId}:${email}`}))`
    const open = await tx.companyInvitation.findFirst({
      where: { companyId: input.companyId, email, acceptedAt: null, revokedAt: null },
      select: { id: true, expiresAt: true },
    })
    if (open && open.expiresAt.getTime() > now.getTime()) throw new ConflictError(INVITATION_PENDING_MESSAGE)
    // An expired invitation is closed: the new one replaces it.
    if (open) await tx.companyInvitation.update({ where: { id: open.id }, data: { revokedAt: now } })
    return tx.companyInvitation.create({
      data: {
        companyId: input.companyId,
        email,
        role: input.role,
        tokenHash,
        invitedById: input.inviter.id,
        expiresAt: expiry(now),
        lastSentAt: now,
      },
      select: { ...SUMMARY_SELECT, companyId: true },
    })
  })

  let delivery: { emailSent: boolean; link?: string }
  if (inAmbientTransaction()) {
    // An approved MCP action: the email leaves once the invitation is
    // committed (a rollback never leaves a dead link in a mailbox).
    delivery = await deferredInvitationEmail(created, token, input.inviter)
  } else {
    try {
      delivery = await sendInvitationEmail(created, token, input.inviter)
    } catch (error) {
      // Not delivered: nobody holds the link, the invitation is withdrawn.
      await prisma.companyInvitation.delete({ where: { id: created.id } }).catch(() => undefined)
      throw error
    }
  }

  await writeAuditLog('info', 'Invitation envoyée', {
    action: 'MEMBER_INVITED',
    companyId: input.companyId,
    metadata: { invitationId: created.id, email, role: input.role, invitedById: input.inviter.id, emailSent: delivery.emailSent, ...(input.source && { source: input.source }) },
  })
  const [invitation] = await summarize([created], now)
  return { invitation, ...delivery }
}

async function openInvitationOf(companyId: string, invitationId: string) {
  const invitation = await prisma.companyInvitation.findFirst({
    where: { id: invitationId, companyId },
    select: { ...SUMMARY_SELECT, companyId: true, acceptedAt: true, revokedAt: true },
  })
  if (!invitation) throw new NotFoundError(INVITATION_NOT_FOUND_MESSAGE)
  return invitation
}

/**
 * Sends the invitation again with a new link (the previous one stops
 * working) valid INVITATION_TTL_DAYS days from now. Audited.
 */
export async function resendInvitation(input: {
  companyId: string
  invitationId: string
  inviter: InvitationActor
  inviterCan: InviterCan
  source?: 'mcp'
  now?: Date
}): Promise<InviteResult> {
  const now = input.now ?? new Date()
  await assertActionAllowed('invite-member', actorOf(input.inviter))
  await assertCompanyWritable(input.companyId)
  const current = await openInvitationOf(input.companyId, input.invitationId)
  if (current.acceptedAt) throw new ConflictError('Cette invitation a déjà été acceptée.')
  if (current.revokedAt) throw new ConflictError('Cette invitation a été annulée : invitez de nouveau la personne.')
  await assertGrantable(current.role, input.inviterCan)

  await enforceRateLimit('member-invitation', input.inviter.id)
  await enforceRateLimit('invitation-email', current.email)

  const { token, tokenHash } = newToken()
  const { count } = await prisma.companyInvitation.updateMany({
    where: { id: current.id, companyId: input.companyId, acceptedAt: null, revokedAt: null },
    data: { tokenHash, expiresAt: expiry(now), lastSentAt: now, sendCount: { increment: 1 } },
  })
  if (count === 0) throw new ConflictError(INVITATION_UNUSABLE_MESSAGE)
  const updated = await openInvitationOf(input.companyId, current.id)
  const delivery = inAmbientTransaction()
    ? await deferredInvitationEmail(updated, token, input.inviter)
    : await sendInvitationEmail(updated, token, input.inviter)
  await writeAuditLog('info', 'Invitation renvoyée', {
    action: 'MEMBER_INVITATION_RESENT',
    companyId: input.companyId,
    metadata: { invitationId: current.id, email: current.email, role: current.role, emailSent: delivery.emailSent, ...(input.source && { source: input.source }) },
  })
  const [invitation] = await summarize([updated], now)
  return { invitation, ...delivery }
}

/** Revokes an open invitation: its link stops working. Idempotent on a revoked one. Audited. */
export async function revokeInvitation(input: { companyId: string; invitationId: string; source?: 'mcp'; now?: Date }): Promise<{ id: string; revoked: true }> {
  const current = await openInvitationOf(input.companyId, input.invitationId)
  if (current.acceptedAt) throw new ConflictError('Cette invitation a déjà été acceptée : retirez le membre depuis la liste des membres.')
  if (!current.revokedAt) {
    await prisma.companyInvitation.updateMany({
      where: { id: current.id, companyId: input.companyId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: input.now ?? new Date() },
    })
    await writeAuditLog('info', 'Invitation annulée', {
      action: 'MEMBER_INVITATION_REVOKED',
      companyId: input.companyId,
      metadata: { invitationId: current.id, email: current.email, role: current.role, ...(input.source && { source: input.source }) },
    })
  }
  return { id: current.id, revoked: true }
}

// Acceptance (the invitation page, app/(auth)/invitation/[token]).

export type InvitationState = 'open' | 'expired' | 'accepted' | 'revoked'

/** What the invitation page shows about a token; null for an unknown token. */
export interface InvitationView {
  state: InvitationState
  companyName: string
  email: string
  role: string
  roleLabel: string
  inviterName: string | null
  expiresAt: Date
  /** The invited address has an account whose address is confirmed (it signs in to accept). */
  confirmedAccount: boolean
  /** The instance lets an invitee create their account from the link ('invitation-sign-up'). */
  signUpAllowed: boolean
}

function stateOf(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InvitationState {
  if (row.acceptedAt) return 'accepted'
  if (row.revokedAt) return 'revoked'
  return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'open'
}

const findByToken = (token: string) =>
  TOKEN_FORMAT.test(token)
    ? prisma.companyInvitation.findUnique({
        where: { tokenHash: hashInvitationToken(token) },
        select: { id: true, companyId: true, email: true, role: true, invitedById: true, expiresAt: true, acceptedAt: true, revokedAt: true },
      })
    : Promise.resolve(null)

/** The invitation of `token`, as its page shows it, or null when unknown. */
export async function readInvitation(token: string, now: Date = new Date()): Promise<InvitationView | null> {
  return withSystemContext('invitation-acceptance', async () => {
    const invitation = await findByToken(token)
    if (!invitation) return null
    const [company, inviter, account, signUpAllowed] = await Promise.all([
      prisma.company.findUnique({ where: { id: invitation.companyId }, select: { name: true } }),
      invitation.invitedById ? prisma.user.findUnique({ where: { id: invitation.invitedById }, select: { name: true, email: true } }) : null,
      prisma.user.findUnique({ where: { email: invitation.email }, select: { emailVerified: true } }),
      isActionAllowed('invitation-sign-up', null),
    ])
    return {
      state: stateOf(invitation, now),
      companyName: company?.name ?? '',
      email: invitation.email,
      role: invitation.role,
      roleLabel: ROLE_LABELS[invitation.role] ?? invitation.role,
      inviterName: inviter ? inviter.name?.trim() || inviter.email : null,
      expiresAt: invitation.expiresAt,
      confirmedAccount: Boolean(account?.emailVerified),
      signUpAllowed,
    }
  })
}

/** Who accepts: the signed-in user, or a new account created from the link. */
export type Acceptor = { user: InvitationActor } | { newAccount: { name: string; password: string } }

export interface AcceptResult {
  companyId: string
  companySlug: string
  userId: string
  email: string
  createdUser: boolean
}

/**
 * Accepts the invitation of `token`: the membership is created with the
 * invited role, and the invitation is closed (single use). Throws a French
 * error otherwise (unknown, expired, revoked or used link, another account,
 * account creation refused by the instance, read-only company).
 */
export async function acceptInvitation(token: string, acceptor: Acceptor, now: Date = new Date()): Promise<AcceptResult> {
  return withSystemContext('invitation-acceptance', async () => {
    const invitation = await findByToken(token)
    if (!invitation) throw new NotFoundError(INVITATION_NOT_FOUND_MESSAGE)
    if (stateOf(invitation, now) !== 'open') throw new ConflictError(INVITATION_UNUSABLE_MESSAGE)

    // The instance may have stopped invitations since this one was sent.
    const inviter = invitation.invitedById
      ? await prisma.user.findUnique({ where: { id: invitation.invitedById }, select: { id: true, email: true, role: true } })
      : null
    await assertActionAllowed('invite-member', inviter)
    await assertCompanyWritable(invitation.companyId)

    const account = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true, email: true, emailVerified: true } })
    let userId: string
    let createdUser = false
    if ('user' in acceptor) {
      if (acceptor.user.email.trim().toLowerCase() !== invitation.email || !account || account.id !== acceptor.user.id) {
        throw new ForbiddenError(WRONG_ACCOUNT_MESSAGE)
      }
      // An unconfirmed address proves nothing about who registered it (KLEDG-SEC-011): the link's form resets it.
      if (!account.emailVerified) throw new ConflictError("Confirmez d'abord l'adresse de votre compte, ou choisissez un mot de passe depuis ce lien.")
      userId = account.id
    } else {
      if (account?.emailVerified) throw new ConflictError(ACCOUNT_EXISTS_MESSAGE)
      if (!(await isActionAllowed('invitation-sign-up', null))) throw new ForbiddenError(SIGN_UP_REFUSED_MESSAGE)
      const name = acceptor.newAccount.name.trim() || invitation.email.split('@')[0]
      if (account) {
        // Registered but never confirmed: taken over like a new account, its sessions and keys gone.
        await resetUnconfirmedAccount(account.id, name, acceptor.newAccount.password)
        userId = account.id
      } else {
        await auth.api.createUser({ body: { email: invitation.email, password: acceptor.newAccount.password, name, role: 'user' } })
        const created = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } })
        if (!created) throw new ConflictError("Le compte n'a pas pu être créé : réessayez.")
        // The link reached this mailbox: the address is confirmed.
        await prisma.user.update({ where: { id: created.id }, data: { emailVerified: true } })
        userId = created.id
      }
      createdUser = true
    }

    const organization = await ensureCompanyOrganization(invitation.companyId)
    await prisma.$transaction(async (tx) => {
      // Single use: only the first acceptance closes the invitation.
      const { count } = await tx.companyInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now, acceptedById: userId },
      })
      if (count === 0) throw new ConflictError(INVITATION_UNUSABLE_MESSAGE)
      const existing = await tx.member.findFirst({ where: { userId, organizationId: organization.id }, select: { id: true } })
      if (!existing) {
        await tx.member.create({
          data: { id: randomBytes(12).toString('hex'), userId, organizationId: organization.id, role: invitation.role, createdAt: now },
        })
      }
    })

    const company = await prisma.company.findUniqueOrThrow({ where: { id: invitation.companyId }, select: { slug: true } })
    await writeAuditLog('info', 'Invitation acceptée', {
      action: 'MEMBER_INVITATION_ACCEPTED',
      companyId: invitation.companyId,
      metadata: { invitationId: invitation.id, userId, email: invitation.email, role: invitation.role, createdUser },
    })
    return { companyId: invitation.companyId, companySlug: company.slug, userId, email: invitation.email, createdUser }
  })
}
