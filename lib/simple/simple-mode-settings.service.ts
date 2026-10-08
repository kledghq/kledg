/**
 * Company setting of simple mode (docs/categories-simples.md): "Faire
 * valider les saisies du mode simple par l'expert-comptable".
 *
 * On, the entries a user confirms in simple mode stay drafts ("à valider")
 * until a person with the right to validate does it, through the usual
 * validation (PCG art. 1031-3: validation makes an entry definitive). Off,
 * they are validated at once when the user who confirms may validate
 * entries. The stored value is null until someone chooses: the default is
 * then on when the company has a member with the accountant role
 * (decision of the maintainer, 2026-10-04), off otherwise.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { COMPANY_NOT_FOUND_MESSAGE } from '@/lib/rbac/authorize'

type Client = Prisma.TransactionClient | typeof prisma

export interface Accountant {
  name: string
}

export interface SimpleModeSettings {
  /** Whether simple mode entries wait for the accountant (the setting, or its default). */
  accountantReview: boolean
  /** What was chosen; null: the default applies. */
  setting: boolean | null
  /** Members with the accountant role, by name (for "envoyées à Marc Renaud"). */
  accountants: Accountant[]
}

/** Body of PUT /api/companies/[id]/simple-mode-settings. Null goes back to the default. */
export const SimpleModeSettingsBodySchema = z.object({
  accountantReview: z.boolean({ error: 'Indiquez si les saisies doivent être validées par le comptable (true ou false)' }).nullable(),
})

/** Members of the company whose roles include accountant (a membership may hold several roles, comma separated). */
async function companyAccountants(companyId: string, client: Client = prisma): Promise<Accountant[]> {
  const members = await client.member.findMany({
    where: { organization: { companyId }, role: { contains: 'accountant' } },
    select: { role: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return members
    .filter((m) => m.role.split(',').map((r) => r.trim()).includes('accountant'))
    .map((m) => ({ name: m.user.name?.trim() || m.user.email }))
}

export async function getSimpleModeSettings(companyId: string, client: Client = prisma): Promise<SimpleModeSettings> {
  const company = await client.company.findUnique({ where: { id: companyId }, select: { simpleModeAccountantReview: true } })
  if (!company) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  const accountants = await companyAccountants(companyId, client)
  const setting = company.simpleModeAccountantReview
  return { accountantReview: setting ?? accountants.length > 0, setting, accountants }
}

/** Whether entries confirmed now in simple mode wait for the accountant. */
export async function accountantReviewRequired(companyId: string, client: Client = prisma): Promise<boolean> {
  return (await getSimpleModeSettings(companyId, client)).accountantReview
}

export async function updateSimpleModeSettings(companyId: string, input: z.infer<typeof SimpleModeSettingsBodySchema>): Promise<SimpleModeSettings> {
  await prisma.company.update({ where: { id: companyId }, data: { simpleModeAccountantReview: input.accountantReview } })
  return getSimpleModeSettings(companyId)
}
