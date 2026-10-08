/**
 * Who may delete an account. An account is never deleted when it would
 * leave the instance without an administrator, or a company without a
 * company administrator: nobody could then add members, manage the instance
 * or close the books. Checked by the account deletion service and the
 * instance user management (lib/users), and again by Better Auth's
 * beforeDelete hook (lib/auth.ts), so no path skips it.
 *
 * The check and the deletion run under one advisory lock
 * (withInstanceUsersLock): two last administrators deleting their accounts
 * at the same time would otherwise both see the other one and both succeed.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma

/** Key of the advisory lock taken by every change to accounts or administrator roles. */
const INSTANCE_USERS_LOCK = 'kledg:instance-users'

/**
 * Runs `work` in a transaction holding the instance users lock, so the
 * checks it reads (other administrators, company administrators) cannot
 * change until it commits. `work` must use `tx` for its reads; a call to
 * Better Auth inside it (deleteUser, removeUser) runs on its own connection
 * and commits before the lock is released, so the next caller sees it.
 */
export async function withInstanceUsersLock<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${INSTANCE_USERS_LOCK}))`
      return work(tx)
    },
    // Better Auth hashes the password inside the lock (deleteUser).
    { maxWait: 10_000, timeout: 30_000 },
  )
}

/** Administrators who can still sign in (a banned administrator cannot manage anything). */
export const ACTIVE_ADMIN_WHERE = { role: 'admin', OR: [{ banned: null }, { banned: false }] } satisfies Prisma.UserWhereInput

/** Whose account the blockers talk about: the user's own, or another user's (instance user management). */
export type DeletionSubject = 'self' | 'other'

const MESSAGES = {
  self: {
    lastAdmin: "Vous êtes le seul administrateur de l'instance. Donnez ce rôle à un autre compte avant de supprimer le vôtre.",
    lastCompanyAdmin: (names: string) =>
      `Vous êtes le seul administrateur de la société ${names}. Nommez un autre administrateur de la société depuis sa page Membres avant de supprimer votre compte.`,
    lastCompanyAdmins: (names: string) =>
      `Vous êtes le seul administrateur des sociétés ${names}. Nommez un autre administrateur pour chacune depuis sa page Membres avant de supprimer votre compte.`,
  },
  other: {
    lastAdmin: "Ce compte est le seul administrateur de l'instance. Donnez ce rôle à un autre compte avant de le supprimer.",
    lastCompanyAdmin: (names: string) =>
      `Ce compte est le seul administrateur de la société ${names}. Nommez un autre administrateur de la société depuis sa page Membres avant de le supprimer.`,
    lastCompanyAdmins: (names: string) =>
      `Ce compte est le seul administrateur des sociétés ${names}. Nommez un autre administrateur pour chacune depuis sa page Membres avant de le supprimer.`,
  },
} as const

export interface AccountCompany {
  id: string
  name: string
  slug: string
  roles: string[]
  /** Whether this user is the only company administrator left. */
  lastCompanyAdmin: boolean
}

export interface DeletionCheck {
  /** French reasons the account cannot be deleted; empty when it can. */
  blockers: string[]
  /** Companies the user is a member of (they keep their data; the user loses access). */
  companies: AccountCompany[]
}

/** Roles of a member row ("companyAdmin,accountant" style lists). */
export function memberRoles(role: string): string[] {
  return role
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
}

export async function checkAccountDeletion(
  user: { id: string; role: string | null },
  options: { db?: Db; subject?: DeletionSubject } = {},
): Promise<DeletionCheck> {
  const db = options.db ?? prisma
  const messages = MESSAGES[options.subject ?? 'self']
  const blockers: string[] = []

  if (user.role === 'admin') {
    const otherAdmins = await db.user.count({ where: { ...ACTIVE_ADMIN_WHERE, id: { not: user.id } } })
    if (otherAdmins === 0) blockers.push(messages.lastAdmin)
  }

  const memberships = await db.member.findMany({
    where: { userId: user.id, organization: { companyId: { not: null } } },
    select: {
      role: true,
      organizationId: true,
      organization: { select: { company: { select: { id: true, name: true, slug: true } } } },
    },
  })

  const adminOrgIds = memberships
    .filter((m) => memberRoles(m.role).includes('companyAdmin'))
    .map((m) => m.organizationId)
  // Other company administrators of the same companies, in one query.
  const otherAdmins = adminOrgIds.length
    ? await db.member.findMany({
        where: { organizationId: { in: adminOrgIds }, userId: { not: user.id }, role: { contains: 'companyAdmin' } },
        select: { organizationId: true, role: true },
      })
    : []
  const orgsWithOtherAdmin = new Set(
    otherAdmins.filter((m) => memberRoles(m.role).includes('companyAdmin')).map((m) => m.organizationId),
  )

  const companies: AccountCompany[] = []
  for (const m of memberships) {
    const company = m.organization.company
    if (!company) continue
    const roles = memberRoles(m.role)
    const lastCompanyAdmin = roles.includes('companyAdmin') && !orgsWithOtherAdmin.has(m.organizationId)
    companies.push({ id: company.id, name: company.name, slug: company.slug, roles, lastCompanyAdmin })
  }
  companies.sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  const orphaned = companies.filter((c) => c.lastCompanyAdmin)
  if (orphaned.length > 0) {
    const names = orphaned.map((c) => c.name).join(', ')
    blockers.push(orphaned.length === 1 ? messages.lastCompanyAdmin(names) : messages.lastCompanyAdmins(names))
  }

  return { blockers, companies }
}
