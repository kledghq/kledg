/**
 * The database side of a mocked session. Route tests mock the signed-in user
 * (`@/lib/session`) and often its roles (`getUserRolesForCompany`); under row
 * level security (KLEDG_RLS=enforce, docs/rls.md) the database decides what
 * that user reaches from its own rows, so the user and its membership must
 * exist there too, as they would in production.
 */

import type { PrismaClient } from '@prisma/client'

export async function seedMembership(
  prisma: Pick<PrismaClient, 'user' | 'organization' | 'member'>,
  userId: string,
  companyId: string,
  role = 'member',
): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, email: `${userId}@membership.test`, name: userId },
    update: {},
  })
  const organization = await prisma.organization.upsert({
    where: { companyId },
    create: { id: `org-${companyId}`, name: companyId, slug: `org-${companyId}`, createdAt: new Date(), companyId },
    update: {},
  })
  await prisma.member.create({
    data: { id: `member-${userId}-${companyId}`, organizationId: organization.id, userId, role, createdAt: new Date() },
  })
}
