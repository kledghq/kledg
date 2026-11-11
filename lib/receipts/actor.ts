/**
 * Who acts on staged receipts (stage-receipt.service.ts): every member
 * stages and files their own receipts; a member who reconciles the bank
 * (banking:reconcile) or validates expense reports (expenses:validate) also
 * reaches the receipts other members staged.
 *
 * The same rule covers the receipts already in Kledg (attachments) that an
 * expense line refers to: the receipts of the bank transactions are the
 * company's, a receipt filed from a photo is its author's
 * (receiptAttachmentsVisibleTo).
 */

import type { Prisma } from '@prisma/client'
import { getUserRolesForCompany, isGlobalAdmin, rolesGrant, type Permission } from '@/lib/rbac/authorize'
import type { CurrentUser } from '@/lib/session'
import type { StagedReceiptActor } from './stage-receipt.service'

type Can = (permission: Permission) => boolean

/** The actor of a route, from the wrapper's user and `can` (lib/api/route.ts). */
export function routeReceiptActor(ctx: { user: Pick<CurrentUser, 'id'>; can: Can }): StagedReceiptActor {
  return { userId: ctx.user.id, seesAll: ctx.can({ banking: ['reconcile'] }) || ctx.can({ expenses: ['validate'] }) }
}

/**
 * The receipts (attachments) a member may list, open or put on an expense
 * line. A member who sees all: every receipt of the company. Any other
 * member: the receipts of a bank transaction, and the receipts filed from
 * their own staged receipts or on their own expense reports (claimant
 * linked to them, or recorded by them). Add `companyId` to the filter.
 */
export function receiptAttachmentsVisibleTo(actor: StagedReceiptActor): Prisma.AttachmentWhereInput {
  if (actor.seesAll) return {}
  return {
    OR: [
      { bankTransactionId: { not: null } },
      { stagedReceipts: { some: { uploadedById: actor.userId } } },
      { receiptFile: { is: { stagedReceipts: { some: { uploadedById: actor.userId } } } } },
      { expenseLines: { some: { report: { OR: [{ claimant: { userId: actor.userId } }, { createdById: actor.userId }] } } } },
    ],
  }
}

/** The actor of a user in a company, from their roles (MCP tools). */
export async function receiptActorOf(user: Pick<CurrentUser, 'id' | 'role'>, companyId: string): Promise<StagedReceiptActor> {
  if (isGlobalAdmin(user)) return { userId: user.id, seesAll: true }
  const roles = await getUserRolesForCompany(user.id, companyId)
  return { userId: user.id, seesAll: rolesGrant(roles, { banking: ['reconcile'] }) || rolesGrant(roles, { expenses: ['validate'] }) }
}
