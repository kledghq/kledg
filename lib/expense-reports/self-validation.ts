/**
 * Validating one's own expense report (separation of duties).
 *
 * The author of a report (its claimant's linked user) does not validate it
 * while another member of the company holds the validation right
 * (`expenses:validate`: company administrator, accountant): that member
 * validates it. When the author is the only one, as in a one-person company,
 * the validation is allowed but recorded as such: `selfValidated` on the
 * report, shown in its detail, and `selfValidated: true` in the
 * VALIDATE_EXPENSE_REPORT audit entry. The rule is in the workflow service,
 * so the page, the API and the MCP tool follow it alike.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { rolesGrant } from '@/lib/rbac/authorize'

export const OWN_REPORT_OTHER_VALIDATOR_MESSAGE =
  'Vous ne pouvez pas valider votre propre note de frais : un autre membre de la société a le droit de la valider (administrateur ou comptable). Demandez-lui de la valider.'

/** How the author of a report may validate it: refused (another validator exists) or allowed as the only validator. */
export type OwnValidation = 'refused' | 'sole-validator'

/** Whether a member of the company other than `userId` (and not banned) holds `expenses:validate`. */
export async function otherValidatorExists(
  companyId: string,
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<boolean> {
  const members = await db.member.findMany({
    where: { organization: { companyId }, userId: { not: userId }, NOT: { user: { banned: true } } },
    select: { role: true },
  })
  return members.some((m) =>
    rolesGrant(
      m.role
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
      { expenses: ['validate'] },
    ),
  )
}

/** The author's own validation of a report: refused while another validator exists. */
export async function ownValidation(
  companyId: string,
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OwnValidation> {
  return (await otherValidatorExists(companyId, userId, db)) ? 'refused' : 'sole-validator'
}
