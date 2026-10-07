/**
 * Assignment rules (règles d'affectation) of a company: list, create,
 * replace, duplicate and delete. Used by /api/transaction-rules and the MCP
 * server.
 *
 * A rule stores account codes, not account ids: codes are resolved against
 * the fiscal year of each transaction when the rule is applied
 * (rule-executor.ts). Updating a rule replaces its conditions and entry
 * lines as a whole, in one transaction.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { compileRulePattern } from './rule-regex'
import type { TransactionRuleConditionInput, TransactionRuleEntryLineInput } from './types'

export const RULE_NOT_FOUND_MESSAGE = 'Règle introuvable'

export const RULE_INCLUDE = {
  conditions: true,
  entryLines: { orderBy: { order: 'asc' } },
} satisfies Prisma.TransactionRuleInclude

export type RuleWithDetails = Prisma.TransactionRuleGetPayload<{ include: typeof RULE_INCLUDE }>

/** A number or a decimal string (forms), as a number. */
const ruleNumber = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value, ctx) => {
    const number = Number(value)
    if (!Number.isFinite(number)) {
      ctx.addIssue({ code: 'custom', message: 'Nombre invalide' })
      return z.NEVER
    }
    return number
  })
  .nullable()
  .optional()

const code = z.string().max(20).nullable().optional()

export const RuleConditionSchema = z.object({
  conditionType: z.string().min(1).max(50),
  operator: z.string().min(1).max(50),
  value: z.string().max(500).nullable().optional(),
  value2: z.string().max(500).nullable().optional(),
})

export const RuleEntryLineSchema = z.object({
  accountCode: z.string().max(20),
  lineType: z.string().min(1).max(20),
  amountType: z.string().min(1).max(20),
  amountValue: ruleNumber,
  description: z.string().max(500).nullable().optional(),
  order: z.number().int().min(0).optional(),
  vatType: z.string().max(30).nullable().optional(),
  vatRateSource: z.string().max(20).nullable().optional(),
  vatRate: ruleNumber,
  vatAccountCode: code,
  vatAccount2Code: code,
  vatOnDebit: z.boolean().optional(),
})

/** Body of POST /api/transaction-rules and PUT /api/transaction-rules/[id] (the company id is ignored here). */
export const RuleInputSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(-1000, 'La priorité est comprise entre -1000 et 1000.').max(1000, 'La priorité est comprise entre -1000 et 1000.').optional(),
  journalCode: z.string().min(1).max(10).optional(),
  defaultVatAccountCode: code,
  /** "Créer automatiquement l'écriture": applied by the refresh without a click (lib/transactions/rule-matcher.ts). */
  autoCreate: z.boolean().optional(),
  conditions: z.array(RuleConditionSchema).max(50).optional(),
  entryLines: z.array(RuleEntryLineSchema).max(50).optional(),
})

export interface RuleInput {
  name?: string
  description?: string | null
  enabled?: boolean
  priority?: number
  journalCode?: string
  defaultVatAccountCode?: string | null
  autoCreate?: boolean
  conditions?: TransactionRuleConditionInput[]
  entryLines?: TransactionRuleEntryLineInput[]
}

/**
 * Refuses a regex condition the linear-time matcher cannot run
 * (rule-regex.ts, KLEDG-SEC-001), with the reason in French, before the
 * rule is saved by the API or the MCP server.
 */
export function assertRulePatternsValid(conditions: TransactionRuleConditionInput[]): void {
  for (const [index, condition] of conditions.entries()) {
    if (condition.operator !== 'regex' || !condition.value) continue
    const compiled = compileRulePattern(condition.value)
    if (!compiled.ok) throw new ValidationError(`Condition ${index + 1} : ${compiled.message}`)
  }
}

export interface RulePatternIssue {
  ruleId: string
  ruleName: string
  conditionId: string
  message: string
}

/**
 * Regex conditions of saved rules that the matcher refuses (rules saved
 * before patterns were checked): they never match, and the rules list
 * reports them so the user can fix the pattern.
 */
export function findRulePatternIssues(rules: RuleWithDetails[]): RulePatternIssue[] {
  const issues: RulePatternIssue[] = []
  for (const rule of rules) {
    for (const condition of rule.conditions) {
      if (condition.operator !== 'regex' || !condition.value) continue
      const compiled = compileRulePattern(condition.value)
      if (!compiled.ok) issues.push({ ruleId: rule.id, ruleName: rule.name, conditionId: condition.id, message: compiled.message })
    }
  }
  return issues
}

function conditionRows(conditions: TransactionRuleConditionInput[]) {
  return conditions.map((cond) => ({
    conditionType: cond.conditionType,
    operator: cond.operator,
    value: cond.value || null,
    value2: cond.value2 || null,
  }))
}

function lineRows(entryLines: TransactionRuleEntryLineInput[]) {
  return entryLines.map((line, index) => ({
    accountCode: line.accountCode,
    lineType: line.lineType,
    amountType: line.amountType,
    amountValue: line.amountValue || null,
    description: line.description || null,
    order: line.order !== undefined ? line.order : index,
    vatType: line.vatType || null,
    vatRateSource: line.vatRateSource ?? 'fixed',
    vatRate: line.vatRate || null,
    vatAccountCode: line.vatAccountCode || null,
    vatAccount2Code: line.vatAccount2Code || null,
    vatOnDebit: line.vatOnDebit || false,
  }))
}

/** Rules of a company, highest priority first. */
export function listRules(companyId: string): Promise<RuleWithDetails[]> {
  return prisma.transactionRule.findMany({
    where: { companyId },
    include: RULE_INCLUDE,
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  })
}

/** A rule of the company, or NotFoundError (also for a rule of another company). */
export async function findRule(companyId: string, ruleId: string): Promise<RuleWithDetails> {
  const rule = await prisma.transactionRule.findFirst({ where: { id: ruleId, companyId }, include: RULE_INCLUDE })
  if (!rule) throw new NotFoundError(RULE_NOT_FOUND_MESSAGE)
  return rule
}

export async function createRule(companyId: string, input: RuleInput, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<RuleWithDetails> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('Donnez un nom à la règle.')
  const conditions = input.conditions ?? []
  const entryLines = input.entryLines ?? []
  assertRulePatternsValid(conditions)
  return db.transactionRule.create({
    data: {
      companyId,
      name,
      description: input.description,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      journalCode: input.journalCode ?? 'BQ',
      defaultVatAccountCode: input.defaultVatAccountCode || null,
      autoCreate: input.autoCreate ?? false,
      conditions: { create: conditionRows(conditions) },
      entryLines: { create: lineRows(entryLines) },
    },
    include: RULE_INCLUDE,
  })
}

/**
 * Replaces a rule: scalar fields left undefined keep their value, conditions
 * and entry lines are replaced by the given lists (empty when omitted).
 */
export async function updateRule(companyId: string, ruleId: string, input: RuleInput): Promise<RuleWithDetails> {
  return prisma.$transaction((tx) => updateRuleInTx(tx, companyId, ruleId, input))
}

/** updateRule inside the caller's transaction. */
export async function updateRuleInTx(tx: Prisma.TransactionClient, companyId: string, ruleId: string, input: RuleInput): Promise<RuleWithDetails> {
  assertRulePatternsValid(input.conditions ?? [])
  const rule = await tx.transactionRule.findFirst({ where: { id: ruleId, companyId }, select: { id: true } })
  if (!rule) throw new NotFoundError(RULE_NOT_FOUND_MESSAGE)
  await tx.transactionRuleCondition.deleteMany({ where: { ruleId: rule.id } })
  await tx.transactionRuleEntryLine.deleteMany({ where: { ruleId: rule.id } })
  return tx.transactionRule.update({
    where: { id: rule.id },
    data: {
      name: input.name,
      description: input.description || null,
      enabled: input.enabled,
      priority: input.priority,
      journalCode: input.journalCode,
      defaultVatAccountCode: input.defaultVatAccountCode || null,
      autoCreate: input.autoCreate,
      conditions: { create: conditionRows(input.conditions ?? []) },
      entryLines: { create: lineRows(input.entryLines ?? []) },
    },
    include: RULE_INCLUDE,
  })
}

/** Deletes a rule of the company. Entries it created stay. */
export async function deleteRule(companyId: string, ruleId: string): Promise<{ id: string; name: string }> {
  return prisma.$transaction(async (tx) => {
    const rule = await tx.transactionRule.findFirst({ where: { id: ruleId, companyId }, select: { id: true, name: true } })
    if (!rule) throw new NotFoundError(RULE_NOT_FOUND_MESSAGE)
    await tx.transactionRule.delete({ where: { id: rule.id } })
    return rule
  })
}

/**
 * Copies a rule of the company with its conditions and entry lines, disabled
 * and named "<name> (copie)", so it can be adjusted before it applies.
 */
export async function duplicateRule(companyId: string, ruleId: string): Promise<{ original: RuleWithDetails; copy: RuleWithDetails }> {
  const original = await findRule(companyId, ruleId)
  const copy = await prisma.transactionRule.create({
    data: {
      companyId,
      name: `${original.name} (copie)`,
      description: original.description,
      enabled: false,
      priority: original.priority,
      journalCode: original.journalCode,
      defaultVatAccountCode: original.defaultVatAccountCode,
      autoCreate: original.autoCreate,
      conditions: {
        create: original.conditions.map((c) => ({ conditionType: c.conditionType, operator: c.operator, value: c.value, value2: c.value2 })),
      },
      entryLines: {
        create: original.entryLines.map((line) => ({
          accountCode: line.accountCode,
          lineType: line.lineType,
          amountType: line.amountType,
          amountValue: line.amountValue,
          description: line.description,
          order: line.order,
          vatType: line.vatType,
          vatRateSource: line.vatRateSource ?? 'fixed',
          vatRate: line.vatRate,
          vatAccountCode: line.vatAccountCode,
          vatAccount2Code: line.vatAccount2Code,
          vatOnDebit: line.vatOnDebit,
        })),
      },
    },
    include: RULE_INCLUDE,
  })
  return { original, copy }
}
