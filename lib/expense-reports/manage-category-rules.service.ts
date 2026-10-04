/**
 * Keyword rules giving the category of expense lines (category-rules.ts),
 * one list per company. Read by every member who submits reports (the editor
 * applies them); written by those who validate.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { EXPENSE_LINE_CATEGORIES, isExpenseAccountCode, type ExpenseCategory } from './categories'
import type { CategoryRule } from './category-rules'

const RULE_NOT_FOUND = 'Règle introuvable'

/** Body of POST /api/expense-category-rules. */
export const CategoryRuleBodySchema = z.object({
  keyword: z.string({ error: 'Le mot-clé est requis' }).trim().min(2, 'Deux caractères au moins').max(100),
  category: z.enum(EXPENSE_LINE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]], { error: 'Catégorie inconnue' }),
  accountCode: optionalText(20).refine((code) => !code || isExpenseAccountCode(code), 'Le compte est un compte de charges (classe 6)'),
  priority: z.number().int().min(0).max(1000).default(0),
})

/** Body of PATCH /api/expense-category-rules/[id]. */
export const UpdateCategoryRuleBodySchema = CategoryRuleBodySchema.partial()

const SELECT = { id: true, keyword: true, category: true, accountCode: true, priority: true } as const

export async function listCategoryRules(companyId: string, db: Pick<typeof prisma, 'expenseCategoryRule'> = prisma): Promise<{ rules: CategoryRule[] }> {
  const rows = await db.expenseCategoryRule.findMany({ where: { companyId }, select: SELECT, orderBy: [{ priority: 'desc' }, { keyword: 'asc' }], take: 500 })
  return { rules: rows.map((r) => ({ ...r, category: r.category as ExpenseCategory })) }
}

export async function createCategoryRule(companyId: string, input: z.infer<typeof CategoryRuleBodySchema>): Promise<CategoryRule> {
  const row = await prisma.expenseCategoryRule.create({
    data: { companyId, keyword: input.keyword, category: input.category, accountCode: input.accountCode ?? null, priority: input.priority },
    select: SELECT,
  })
  await writeAuditLog('info', 'Expense category rule created', { action: 'CREATE_EXPENSE_CATEGORY_RULE', companyId, metadata: { ruleId: row.id } })
  return { ...row, category: row.category as ExpenseCategory }
}

export async function updateCategoryRule(companyId: string, id: string, input: z.infer<typeof UpdateCategoryRuleBodySchema>): Promise<CategoryRule> {
  const existing = await prisma.expenseCategoryRule.findFirst({ where: { id, companyId }, select: { id: true } })
  if (!existing) throw new NotFoundError(RULE_NOT_FOUND)
  const row = await prisma.expenseCategoryRule.update({
    where: { id },
    data: {
      ...(input.keyword ? { keyword: input.keyword } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.accountCode !== undefined ? { accountCode: input.accountCode } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    },
    select: SELECT,
  })
  return { ...row, category: row.category as ExpenseCategory }
}

export async function deleteCategoryRule(companyId: string, id: string): Promise<{ id: string }> {
  const deleted = await prisma.expenseCategoryRule.deleteMany({ where: { id, companyId } })
  if (deleted.count === 0) throw new NotFoundError(RULE_NOT_FOUND)
  await writeAuditLog('info', 'Expense category rule deleted', { action: 'DELETE_EXPENSE_CATEGORY_RULE', companyId, metadata: { ruleId: id } })
  return { id }
}
