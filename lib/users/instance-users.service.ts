/**
 * Instance user management for instance administrators (the "Utilisateurs"
 * settings page): list the accounts, change a role, ban or unban, change an
 * email address and delete an account.
 *
 * Every change goes through the instance policy ("manage-users", so a
 * customised instance can refuse it), the instance users rate limit, and
 * Better Auth's admin plugin, called with the administrator's own session
 * (setRole, banUser, unbanUser, adminUpdateUser, removeUser). Better Auth's
 * HTTP endpoints for the changes made here are closed (lib/auth-policy.ts):
 * they would skip the checks below.
 *
 * Invariants, checked under the instance users lock (withInstanceUsersLock)
 * so that two administrators acting at once cannot break them:
 * - the instance always keeps an administrator who can sign in;
 * - an administrator never changes their own role, bans or deletes
 *   themselves here (the profile page has its own guarded deletion);
 * - a deletion obeys the same guards as a self-deletion (last instance or
 *   company administrator, lib/account/deletion-guards.ts).
 * The acting administrator is read again under the lock: an administrator
 * demoted or banned a moment ago can no longer act.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { assertActionAllowed, isActionAllowed, actionRefusalMessage } from '@/lib/instance'
import { enforceRateLimit } from '@/lib/rate-limit'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { callAuth } from '@/lib/account/auth-errors'
import { ACTIVE_ADMIN_WHERE, checkAccountDeletion, withInstanceUsersLock } from '@/lib/account/deletion-guards'
import type { CurrentUser } from '@/lib/session'
import type { ChangeUserEmailInput, CreateInstanceUserInput, InstanceRole } from './schemas'

/** What the page shows of an account: never a password, token or key. */
export interface InstanceUser {
  id: string
  email: string
  name: string
  role: InstanceRole
  banned: boolean
  emailVerified: boolean
  createdAt: string
  /** Last activity of the most recent session still stored, or null. */
  lastSessionAt: string | null
}

/** Accounts listed on the page (an instance has a handful of users; the search narrows larger ones). */
export const INSTANCE_USERS_LIMIT = 200

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  banned: true,
  emailVerified: true,
  createdAt: true,
} satisfies Prisma.UserSelect

export async function listInstanceUsers(options: { search?: string } = {}): Promise<InstanceUser[]> {
  const search = options.search?.trim()
  const users = await prisma.user.findMany({
    where: search
      ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] }
      : undefined,
    select: USER_SELECT,
    orderBy: { email: 'asc' },
    take: INSTANCE_USERS_LIMIT,
  })
  const sessions = users.length
    ? await prisma.session.groupBy({
        by: ['userId'],
        where: { userId: { in: users.map((u) => u.id) } },
        _max: { updatedAt: true },
      })
    : []
  const lastSession = new Map(sessions.map((s) => [s.userId, s._max.updatedAt]))
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role === 'admin' ? 'admin' : 'user',
    banned: u.banned === true,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt.toISOString(),
    lastSessionAt: lastSession.get(u.id)?.toISOString() ?? null,
  }))
}

/**
 * Creates a regular account (POST /api/users). The acting administrator is
 * the one getCurrentUser confirmed from the database; Better Auth is called
 * in process (its /admin/create-user HTTP endpoint is closed, as it reads the
 * role from the session cache). Becoming an administrator is a separate,
 * guarded role change.
 */
export async function createInstanceUser(admin: CurrentUser, input: CreateInstanceUserInput): Promise<{ id: string; email: string }> {
  await assertActionAllowed('manage-users', actorOf(admin))
  await enforceRateLimit('instance-users', admin.id)
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw new ConflictError('Un compte existe déjà avec cette adresse email.')
  }
  const created = await callAuth(() =>
    auth.api.createUser({
      body: { email: input.email, password: input.password, name: input.name || input.email.split('@')[0], role: 'user' },
    }),
  )
  return { id: created.user.id, email: created.user.email }
}

export type ManageUsersState = { allowed: true } | { allowed: false; message: string }

/** Whether this instance lets `admin` manage users (the page disables its actions otherwise). */
export async function manageUsersState(admin: CurrentUser): Promise<ManageUsersState> {
  return (await isActionAllowed('manage-users', actorOf(admin)))
    ? { allowed: true }
    : { allowed: false, message: actionRefusalMessage('manage-users') }
}

function actorOf(user: CurrentUser) {
  return { id: user.id, email: user.email, role: user.role }
}

type Tx = Prisma.TransactionClient
type Target = { id: string; email: string; role: string | null; banned: boolean | null }

/**
 * Policy, rate limit, then `work` under the instance users lock with the
 * acting administrator confirmed and the target loaded.
 */
async function manage<T>(
  admin: CurrentUser,
  userId: string,
  work: (tx: Tx, target: Target) => Promise<T>,
  options: { allowSelf?: boolean; selfMessage?: string } = {},
): Promise<T> {
  await assertActionAllowed('manage-users', actorOf(admin))
  if (!options.allowSelf && userId === admin.id) {
    throw new ValidationError(options.selfMessage ?? 'Utilisez la page Profil pour modifier votre propre compte.')
  }
  await enforceRateLimit('instance-users', admin.id)
  return withInstanceUsersLock(async (tx) => {
    const actor = await tx.user.findFirst({ where: { id: admin.id, ...ACTIVE_ADMIN_WHERE }, select: { id: true } })
    if (!actor) throw new ForbiddenError("Action réservée aux administrateurs de l'instance.")
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, banned: true },
    })
    if (!target) throw new NotFoundError('Utilisateur introuvable')
    return work(tx, target)
  })
}

/** At least one administrator who can sign in remains once `target` stops being one. */
async function assertAnotherActiveAdmin(tx: Tx, target: Target): Promise<void> {
  if (target.role !== 'admin') return
  const others = await tx.user.count({ where: { ...ACTIVE_ADMIN_WHERE, id: { not: target.id } } })
  if (others === 0) {
    throw new ConflictError("Ce compte est le seul administrateur de l'instance. Donnez ce rôle à un autre compte d'abord.")
  }
}

export async function setInstanceUserRole(admin: CurrentUser, headers: Headers, userId: string, role: InstanceRole): Promise<void> {
  await manage(
    admin,
    userId,
    async (tx, target) => {
      if ((target.role === 'admin' ? 'admin' : 'user') === role) return
      if (role !== 'admin') await assertAnotherActiveAdmin(tx, target)
      await callAuth(() => auth.api.setRole({ headers, body: { userId, role } }))
    },
    { selfMessage: 'Vous ne pouvez pas changer votre propre rôle. Demandez-le à un autre administrateur.' },
  )
}

export async function setInstanceUserBanned(admin: CurrentUser, headers: Headers, userId: string, banned: boolean): Promise<void> {
  await manage(
    admin,
    userId,
    async (tx, target) => {
      if ((target.banned === true) === banned) return
      if (banned) {
        await assertAnotherActiveAdmin(tx, target)
        // Better Auth also revokes the user's sessions.
        await callAuth(() => auth.api.banUser({ headers, body: { userId } }))
      } else {
        await callAuth(() => auth.api.unbanUser({ headers, body: { userId } }))
      }
    },
    { selfMessage: 'Vous ne pouvez pas bloquer votre propre compte.' },
  )
}

/**
 * Changes another user's sign-in address, confirmed by the administrator's
 * own password. The new address is not verified: nobody proved the mailbox
 * exists, the administrator chose it.
 */
export async function changeInstanceUserEmail(
  admin: CurrentUser,
  headers: Headers,
  userId: string,
  input: ChangeUserEmailInput,
): Promise<{ email: string }> {
  return manage(
    admin,
    userId,
    async (tx, target) => {
      if (input.email === target.email.toLowerCase()) throw new ValidationError("C'est déjà l'adresse de ce compte.")
      await callAuth(() => auth.api.verifyPassword({ headers, body: { password: input.password } }))
      const taken = await tx.user.findFirst({ where: { email: input.email, id: { not: userId } }, select: { id: true } })
      if (taken) throw new ConflictError('Cette adresse est déjà utilisée par un autre compte.')
      await callAuth(() =>
        auth.api.adminUpdateUser({ headers, body: { userId, data: { email: input.email, emailVerified: false } } }),
      )
      return { email: input.email }
    },
    { selfMessage: 'Changez votre propre adresse depuis la page Profil.' },
  )
}

/**
 * Deletes another user's account with the guards of a self-deletion. The
 * user's companies and books are kept; their API keys go with them.
 */
export async function deleteInstanceUser(admin: CurrentUser, headers: Headers, userId: string): Promise<{ email: string }> {
  return manage(
    admin,
    userId,
    async (tx, target) => {
      const { blockers } = await checkAccountDeletion({ id: target.id, role: target.role }, { db: tx, subject: 'other' })
      if (blockers.length > 0) throw new ConflictError(blockers.join(' '))
      await callAuth(() => auth.api.removeUser({ headers, body: { userId } }))
      // API keys reference their user without a foreign key (as in lib/auth.ts, afterDelete).
      await tx.apikey.deleteMany({ where: { referenceId: userId } })
      return { email: target.email }
    },
    { selfMessage: 'Supprimez votre propre compte depuis la page Profil.' },
  )
}
