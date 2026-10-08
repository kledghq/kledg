import { randomBytes } from 'crypto'
import { hashPassword } from 'better-auth/crypto'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { roles } from '@/lib/permissions'
import { ensureCompanyOrganization } from './ensure-company-organization.service'
import { isEmailEnabled } from '@/lib/email'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'

/** Roles a member can hold in a company (lib/permissions.ts defines what each one grants). */
export const COMPANY_ROLES = ['companyAdmin', 'accountant', 'viewer'] as const

export type CompanyRoleName = (typeof COMPANY_ROLES)[number]

export type AddMemberInput = {
  companyId: string
  email: string
  name?: string
  role: CompanyRoleName
}

export type AddMemberResult = {
  userId: string
  memberId: string
  createdUser: boolean
  /**
   * The address belonged to an account never confirmed: it was taken over
   * like a new account (sessions, password, keys and assistants of whoever
   * registered it are gone) and the person chooses their password.
   */
  resetUnconfirmedUser: boolean
  /** Only set when email is disabled: the admin must pass it on manually. */
  generatedPassword?: string
  /** True when a "choose your password" email was sent. */
  welcomeEmailSent: boolean
  roles: string[]
}

function assertValidRole(role: string): asserts role is CompanyRoleName {
  if (!COMPANY_ROLES.includes(role as CompanyRoleName)) {
    throw new ValidationError(
      `Rôle invalide. Valeurs acceptées : ${COMPANY_ROLES.join(', ')}`
    )
  }
}

function generatePassword(): string {
  return randomBytes(12).toString('base64url')
}

/**
 * KLEDG-SEC-011 (kledg-cloud KLEDG-CLOUD-004). An account whose address was
 * never confirmed proves nothing about who registered it: on an instance
 * with public sign-up, anyone can register a colleague's address before an
 * administrator adds it to a company. Before the membership is granted, the
 * account is reset like a new one: every session ends, the password is
 * replaced (`password`), other sign-in methods, API keys, assistant grants
 * and tokens, pending assistant actions and reset tokens are removed, and
 * the address counts as confirmed by the welcome link, as for a new account.
 */
async function resetUnconfirmedAccount(userId: string, name: string, password: string): Promise<void> {
  const hashed = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } })
    await tx.authAccount.deleteMany({ where: { userId, providerId: { not: 'credential' } } })
    const credential = await tx.authAccount.updateMany({ where: { userId, providerId: 'credential' }, data: { password: hashed } })
    if (credential.count === 0) {
      await tx.authAccount.create({ data: { id: randomBytes(16).toString('hex'), accountId: userId, providerId: 'credential', userId, password: hashed } })
    }
    await tx.apikey.deleteMany({ where: { referenceId: userId } })
    await tx.oauthConsent.deleteMany({ where: { userId } })
    await tx.oauthAccessToken.deleteMany({ where: { userId } })
    await tx.oauthRefreshToken.deleteMany({ where: { userId } })
    await tx.aiAccessGrant.deleteMany({ where: { userId } })
    await tx.mcpPendingAction.deleteMany({ where: { userId } })
    await tx.mcpConfirmation.deleteMany({ where: { userId } })
    await tx.verification.deleteMany({ where: { value: userId } })
    await tx.user.update({ where: { id: userId }, data: { emailVerified: true, name } })
  })
}

export async function addMemberToCompany(
  input: AddMemberInput
): Promise<AddMemberResult> {
  const email = input.email.trim().toLowerCase()
  if (!email) throw new ValidationError("L'email est requis")
  assertValidRole(input.role)

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, name: true },
  })
  if (!company) throw new NotFoundError('Société introuvable')

  const organization = await ensureCompanyOrganization(company.id)

  let user = await prisma.user.findUnique({ where: { email } })
  let generatedPassword: string | undefined
  let createdUser = false
  let resetUnconfirmedUser = false

  let welcomeEmailSent = false

  if (user && !user.emailVerified) {
    const existingMember = await prisma.member.findFirst({ where: { userId: user.id, organizationId: organization.id }, select: { id: true } })
    if (existingMember) throw new ConflictError('Cet utilisateur est déjà membre de cette société')
    const password = generatePassword()
    await resetUnconfirmedAccount(user.id, input.name?.trim() || email.split('@')[0], password)
    resetUnconfirmedUser = true
    if (await isEmailEnabled()) {
      await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password?welcome=1' } })
      welcomeEmailSent = true
    } else {
      generatedPassword = password
    }
  }

  if (!user) {
    const password = generatePassword()
    await auth.api.createUser({
      body: {
        email,
        password,
        name: input.name?.trim() || email.split('@')[0],
        role: 'user',
      },
    })
    user = await prisma.user.findUnique({ where: { email } })
    // Created then gone (deleted meanwhile): a French 409, never an untyped 500
    if (!user) throw new ConflictError("Le compte de l'utilisateur n'a pas pu être créé\u00a0: réessayez.")
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    })
    createdUser = true

    if (await isEmailEnabled()) {
      // The user chooses their own password through an emailed link.
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: '/reset-password?welcome=1' },
      })
      welcomeEmailSent = true
    } else {
      generatedPassword = password
    }
  }

  const existingMember = await prisma.member.findFirst({
    where: { userId: user.id, organizationId: organization.id },
  })
  if (existingMember) {
    throw new ConflictError(
      'Cet utilisateur est déjà membre de cette société'
    )
  }

  const roleList: string[] = [input.role]
  // Validate each role is known.
  for (const r of roleList) {
    if (!(r in roles)) {
      throw new ValidationError(`Rôle inconnu : ${r}`)
    }
  }

  const member = await prisma.member.create({
    data: {
      id: randomBytes(12).toString('hex'),
      userId: user.id,
      organizationId: organization.id,
      role: roleList.join(','),
      createdAt: new Date(),
    },
  })

  return {
    userId: user.id,
    memberId: member.id,
    createdUser,
    resetUnconfirmedUser,
    generatedPassword,
    welcomeEmailSent,
    roles: roleList,
  }
}
