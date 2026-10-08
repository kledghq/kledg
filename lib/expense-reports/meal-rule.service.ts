/**
 * Database side of the rule on the meals of the exploitant
 * (exploitant-meals.ts, docs/notes-de-frais.md): the company's taxation on a
 * day, the role of a claimant, the non-deductible account of a fiscal
 * year, and what the line editor asks (GET /api/expense-reports/meal-rule).
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { optionalCalendarDay } from '@/lib/api/zod-fields'
import { loadProfitTaxation } from '@/lib/companies/profit-taxation.service'
import { todayUtc, toIsoDateUtc } from '@/lib/utils/date'
import type { ExpenseActor } from './actor'
import { claimantRoleOf, mealRuleOfTaxation, NON_DEDUCTIBLE_MEALS_ACCOUNT, type ClaimantRole, type MealRuleCompany } from './exploitant-meals'
import { loadRootAccount } from '@/lib/accounting/root-account'

type Db = Prisma.TransactionClient | typeof prisma

/** The company side of the rule on each day asked. */
export async function mealRulesOn(companyId: string, days: readonly string[], db: Db = prisma): Promise<Map<string, MealRuleCompany>> {
  const taxation = await loadProfitTaxation(companyId, days, db)
  return new Map([...taxation.entries()].map(([day, t]) => [day, mealRuleOfTaxation(t)]))
}

/** Role of a claimant of the company under the rule. */
export async function claimantMealRole(
  companyId: string,
  claimant: { kind: 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE'; personId: string | null },
  db: Db = prisma,
): Promise<ClaimantRole> {
  const [company, associe] = await Promise.all([
    db.company.findFirst({ where: { id: companyId }, select: { legalType: true } }),
    claimant.personId ? db.shareholder.findFirst({ where: { companyId, personId: claimant.personId, type: 'PHYSICAL' }, select: { id: true } }) : null,
  ])
  return claimantRoleOf({ kind: claimant.kind, legalType: company?.legalType ?? null, associeOfCompany: Boolean(associe), linkedToPerson: claimant.personId !== null })
}

/**
 * The account of the non-deductible part in a fiscal year: an account
 * under 62568 when the chart has one, else 62568 created (padded with
 * zeros to the length of the line's account, 625680 for a chart of six
 * digits), under its closest parent.
 */
export async function nonDeductibleMealsAccount(
  tx: Db,
  companyId: string,
  fiscalYearId: string,
  lineAccountCode: string,
): Promise<{ id: string; code: string }> {
  const root = NON_DEDUCTIBLE_MEALS_ACCOUNT.root
  // The rule every module shares (lib/accounting/root-account.ts)
  const pick = await loadRootAccount(tx, companyId, fiscalYearId, root)
  if (pick) return { id: pick.id, code: pick.code }
  const code = root.padEnd(Math.max(root.length, lineAccountCode.length), '0')
  const parents = await tx.account.findMany({
    where: { companyId, fiscalYearId, code: { in: Array.from({ length: code.length - 1 }, (_, i) => code.slice(0, i + 1)) } },
    select: { id: true, code: true },
  })
  const parent = parents.sort((a, b) => b.code.length - a.code.length)[0] ?? null
  return tx.account.upsert({
    where: { companyId_code_fiscalYearId: { companyId, code, fiscalYearId } },
    update: {},
    create: { companyId, fiscalYearId, code, label: NON_DEDUCTIBLE_MEALS_ACCOUNT.label, parentId: parent?.id ?? null, isPCG: false },
    select: { id: true, code: true },
  })
}

/** ?companyId=&claimantId=&day= of GET /api/expense-reports/meal-rule. */
export const MealRuleQuerySchema = z.object({
  claimantId: z.string().max(64).optional(),
  day: optionalCalendarDay('day doit être une date valide'),
})
export type MealRuleQuery = z.output<typeof MealRuleQuerySchema>

export interface MealRuleView {
  day: string
  company: MealRuleCompany
  claimant: ClaimantRole
}

/**
 * What the line editor needs to show the split: the company side on the
 * day (the report's last day, today by default) and the role of the
 * claimant (the actor's own claimant when none is given; a member who only
 * submits reports reads only their own).
 */
export async function loadMealRule(companyId: string, actor: ExpenseActor, query: MealRuleQuery, now = new Date()): Promise<MealRuleView> {
  const day = query.day || toIsoDateUtc(todayUtc(now))
  const claimant = await prisma.expenseClaimant.findFirst({
    where: query.claimantId ? { id: query.claimantId, companyId, ...(actor.canManage ? {} : { userId: actor.userId }) } : { companyId, userId: actor.userId },
    select: { kind: true, personId: true },
  })
  if (query.claimantId && !claimant) throw new NotFoundError('Bénéficiaire introuvable')
  const [rules, role] = await Promise.all([
    mealRulesOn(companyId, [day]),
    // A member's first report creates their claimant as an employee without person: the same unknown role
    claimantMealRole(companyId, claimant ?? { kind: 'EMPLOYEE', personId: null }),
  ])
  return { day, company: rules.get(day)!, claimant: role }
}
