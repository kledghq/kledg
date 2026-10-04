import { randomBytes } from 'crypto'
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
  /** Only set when email is disabled: the admin must pass it on manually. */
  generatedPassword?: string
  /** True when a "choose your password" email was sent. */
  welcomeEmailSent: boolean
  roles: string[]
}

function assertValidRole(role: string): asserts role is CompanyRoleName {
  if (!COMPANY_ROLES.includes(role as CompanyRoleName)) {
    throw new ValidationError(
      `Rôle invalide. Valeurs acceptées : ${COMPANY_ROLES.join(', ')}`
    )
  }
}

function generatePassword(): string {
  return randomBytes(12).toString('base64url')
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

  let welcomeEmailSent = false

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
    if (!user) throw new Error('Échec de la création de l\'utilisateur')
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
      throw new ValidationError(`Rôle inconnu : ${r}`)
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
    generatedPassword,
    welcomeEmailSent,
    roles: roleList,
  }
}
