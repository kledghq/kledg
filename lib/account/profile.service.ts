/**
 * The signed-in user's profile (name). The email has its own flow
 * (change-email.service.ts): it is never changed without proof.
 */

import { prisma } from '@/lib/prisma'
import type { UpdateProfileInput } from './schemas'

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  return prisma.user.update({
    where: { id: userId },
    data: { name: input.name },
    select: { id: true, name: true, email: true },
  })
}
