/**
 * Decisions on detected subscriptions (docs/abonnements.md): confirm one,
 * ignore one (a salary, a transfer between own accounts, a false positive),
 * forget the decision, or add the subscription to the budget as a recurring
 * item of a charges line.
 *
 * The subscription is always detected again on the server from the
 * company's lines: a client never sends the counterparty or the amount it
 * wants stored. Decisions of a company are written under one advisory lock,
 * so two concurrent clicks never create two decisions for one series.
 * Adding to the budget goes through the budgets service in the same
 * transaction as the decision (budgets:manage, checked by the route), so
 * either both are written or neither.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { optionalText } from '@/lib/api/zod-fields'
import { addRecurringItemInTx } from '@/lib/budgets/manage-budgets.service'
import { isMonthKey, monthKeyOfDay } from '@/lib/budgets/months'
import { centsToDecimal } from '@/lib/utils/money'
import { getDetectedSubscription, toDbCadence, type SubscriptionView } from './detect-subscriptions.service'

const subscriptionId = z.string({ error: "L'abonnement est requis" }).trim().min(1, "L'abonnement est requis").max(100, 'Abonnement inconnu')

/** Body of PUT /api/subscriptions/decision. `pending` forgets the decision. */
export const SubscriptionDecisionBodySchema = z.object({
  subscriptionId,
  status: z.enum(['confirmed', 'ignored', 'pending'], { error: 'Décision inconnue : confirmed, ignored ou pending' }),
})
export type SubscriptionDecisionInput = z.infer<typeof SubscriptionDecisionBodySchema>

/** Body of POST /api/subscriptions/budget-item. */
export const AddSubscriptionToBudgetBodySchema = z.object({
  subscriptionId,
  budgetLineId: z.string({ error: 'La ligne de budget est requise' }).trim().min(1, 'La ligne de budget est requise'),
  label: optionalText(120),
  startMonth: z.string().refine(isMonthKey, 'Mois invalide : AAAA-MM').optional(),
})
export type AddSubscriptionToBudgetInput = z.infer<typeof AddSubscriptionToBudgetBodySchema>

type Tx = Prisma.TransactionClient

async function lockDecisions(tx: Tx, companyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:subscription-decisions:${companyId}`}))`
}

/**
 * Writes the decision of a detected subscription: updates the decision it
 * is attached to (its reference amount becomes the current one), else
 * creates it.
 */
async function saveDecision(tx: Tx, companyId: string, sub: SubscriptionView, data: { status: 'CONFIRMED' | 'IGNORED'; budgetLineId?: string }) {
  const referenceAmount = centsToDecimal(sub.typicalAmountCents)
  const existing = sub.decision ? await tx.subscriptionDecision.findFirst({ where: { id: sub.decision.id, companyId }, select: { id: true } }) : null
  if (existing) {
    await tx.subscriptionDecision.update({ where: { id: existing.id }, data: { ...data, referenceAmount } })
    return
  }
  const identity = { companyId, counterpartyKey: sub.counterpartyKey, cadence: toDbCadence(sub.cadence), referenceAmount }
  await tx.subscriptionDecision.upsert({
    where: { companyId_counterpartyKey_cadence_referenceAmount: identity },
    create: { ...identity, ...data },
    update: data,
  })
}

/** Confirms or ignores a detected subscription of the company, or forgets its decision (`pending`). */
export async function decideSubscription(companyId: string, input: SubscriptionDecisionInput, options: { today?: string } = {}): Promise<SubscriptionView> {
  const sub = await getDetectedSubscription(companyId, input.subscriptionId, options)
  await prisma.$transaction(async (tx) => {
    await lockDecisions(tx, companyId)
    if (input.status === 'pending') {
      if (sub.decision) await tx.subscriptionDecision.deleteMany({ where: { id: sub.decision.id, companyId } })
      return
    }
    await saveDecision(tx, companyId, sub, { status: input.status === 'confirmed' ? 'CONFIRMED' : 'IGNORED' })
  })
  await writeAuditLog('info', 'Subscription decision', {
    action: 'DECIDE_SUBSCRIPTION',
    companyId,
    metadata: { subscriptionId: sub.id, cadence: sub.cadence, status: input.status },
  })
  return getDetectedSubscription(companyId, sub.id, options)
}

/**
 * Adds a detected subscription to the budget: a recurring item on a charges
 * line (class 6) of an open budget of the company, at the subscription's
 * current amount and cadence, from the month of its first payment (which
 * keeps the rhythm of a quarterly or yearly payment) unless `startMonth` is
 * given. The subscription is confirmed and linked to the line. A weekly
 * subscription has no budget frequency: its amounts are entered by month.
 */
export async function addSubscriptionToBudget(companyId: string, input: AddSubscriptionToBudgetInput, options: { today?: string } = {}): Promise<SubscriptionView> {
  const sub = await getDetectedSubscription(companyId, input.subscriptionId, options)
  if (sub.cadence === 'weekly') {
    throw new ValidationError("Un abonnement hebdomadaire ne s'ajoute pas comme élément récurrent : saisissez ses montants par mois sur la ligne du budget.")
  }
  const added = await prisma.$transaction(async (tx) => {
    await lockDecisions(tx, companyId)
    const result = await addRecurringItemInTx(
      tx,
      companyId,
      input.budgetLineId,
      {
        label: input.label ?? sub.name.slice(0, 120),
        amountCents: sub.typicalAmountCents,
        frequency: toDbCadence(sub.cadence) as 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
        startMonth: input.startMonth ?? monthKeyOfDay(sub.firstDay),
        endMonth: null,
      },
      { side: 'charges' },
    )
    await saveDecision(tx, companyId, sub, { status: 'CONFIRMED', budgetLineId: result.lineId })
    return result
  })
  await writeAuditLog('info', 'Subscription added to the budget', {
    action: 'ADD_SUBSCRIPTION_TO_BUDGET',
    companyId,
    metadata: { subscriptionId: sub.id, budgetId: added.budgetId, budgetLineId: added.lineId, amountCents: sub.typicalAmountCents, cadence: sub.cadence },
  })
  return getDetectedSubscription(companyId, sub.id, options)
}
