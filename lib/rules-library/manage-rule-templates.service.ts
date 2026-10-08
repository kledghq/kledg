/**
 * The rules library (bibliothèque de règles) of a company: the catalog with
 * the status of each template for the company, the suggestions computed on
 * its bank transactions, the prefill of the rule editor, the accounts a
 * template needs, and the rule added from a template. Used by
 * /api/rule-templates and the MCP server (list_rule_templates,
 * add_rule_from_template).
 *
 * Accounts are mapped to the chart of the active fiscal year
 * (account-mapping.ts) and created only on an explicit request
 * (createMissingAccounts), under the existing account they subdivide.
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { createAccount } from '@/lib/accounting/create-account.service'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { transactionOfCompany } from '@/lib/api/resources'
import { addUtcDays, todayUtc } from '@/lib/utils/date'
import { createRule, listRules, type RuleWithDetails } from '@/lib/transactions/manage-rules.service'
import { mapLines, mapRuleAccounts, type AccountProposal, type ChartAccount, type RuleMapping } from './account-mapping'
import { RULE_TEMPLATES, ruleTemplateById } from './catalog'
import { duplicateStatus, sideOf, type DuplicateStatus, type ExistingRule } from './duplicates'
import { rankTemplateSuggestions, type TemplateSuggestion } from './suggestions'
import { RULE_TEMPLATE_CATEGORIES, type RuleTemplate } from './template'

export const TEMPLATE_NOT_FOUND_MESSAGE = 'Modèle de règle introuvable'
export const NO_FISCAL_YEAR_MESSAGE = "La société n'a pas d'exercice ouvert : créez-en un pour que les comptes de la règle existent."

/** Most recent bank transactions read for the suggestions (12 months at most). */
export const SUGGESTION_TRANSACTION_CAP = 5000
const SUGGESTION_DAYS = 365

/** Labels of the standard PCG accounts, for the accounts to create. */
export const PCG_LABELS: ReadonlyMap<string, string> = new Map(PCG_ACCOUNTS.map((a) => [a.code, a.label]))

/** The chart of the active fiscal year (empty without an open fiscal year). */
export async function loadActiveChart(companyId: string): Promise<{ fiscalYear: { id: string; year: number } | null; chart: ChartAccount[] }> {
  const fiscalYear = await getActiveFiscalYear(companyId)
  if (!fiscalYear) return { fiscalYear: null, chart: [] }
  const chart = await prisma.account.findMany({
    where: { companyId, fiscalYearId: fiscalYear.id },
    select: { id: true, code: true, label: true },
    orderBy: { code: 'asc' },
  })
  return { fiscalYear: { id: fiscalYear.id, year: fiscalYear.year }, chart }
}

function existingRulesOf(rules: RuleWithDetails[]): ExistingRule[] {
  return rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, priority: r.priority, autoCreate: r.autoCreate, conditions: r.conditions }))
}

export interface TemplateView extends RuleTemplate {
  categoryLabel: string
  status: DuplicateStatus
  /** Accounts of the template in the company's chart. */
  accounts: Array<{ code: string; status: string; mappedCode: string | null; mappedLabel: string | null; ambiguous: boolean }>
  /** Accounts the company's chart lacks (they can be created when the template is added). */
  missingAccounts: AccountProposal[]
}

function templateView(template: RuleTemplate, mapping: RuleMapping, rules: ExistingRule[]): TemplateView {
  return {
    ...template,
    categoryLabel: RULE_TEMPLATE_CATEGORIES.find((c) => c.id === template.category)?.label ?? template.category,
    status: duplicateStatus({ name: template.name, conditions: template.conditions, sampleLabels: template.samples.match, side: sideOf(template) }, rules),
    accounts: mapping.accounts.map((a) => ({
      code: a.code,
      status: a.status,
      mappedCode: a.status === 'missing' ? (a.fallback?.code ?? null) : a.account.code,
      mappedLabel: a.status === 'missing' ? (a.fallback?.label ?? null) : a.account.label,
      ambiguous: a.status === 'missing' ? false : a.ambiguous,
    })),
    missingAccounts: mapping.missing,
  }
}

/** Bank transactions of the last 12 months, newest first, with the columns the matcher reads. */
async function recentTransactions(companyId: string, now: Date) {
  const since = addUtcDays(todayUtc(now), -SUGGESTION_DAYS)
  const rows = await prisma.bankTransaction.findMany({
    where: { ...transactionOfCompany(companyId), date: { gte: since } },
    select: {
      label: true,
      reference: true,
      counterpartyName: true,
      category: true,
      cashflowCategory: true,
      cashflowSubcategory: true,
      operationType: true,
      side: true,
      status: true,
      amount: true,
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: SUGGESTION_TRANSACTION_CAP + 1,
  })
  return { since, rows: rows.slice(0, SUGGESTION_TRANSACTION_CAP), truncated: rows.length > SUGGESTION_TRANSACTION_CAP }
}

export interface RuleLibrary {
  categories: typeof RULE_TEMPLATE_CATEGORIES
  templates: TemplateView[]
  suggestions: Array<TemplateSuggestion & { name: string }>
  analysis: { since: string; analyzed: number; covered: number; truncated: boolean }
  /** False without an open fiscal year: accounts cannot be mapped. */
  hasChart: boolean
}

/** The catalog for the company: every template with its status, and the suggestions. */
export async function listRuleTemplates(companyId: string, options: { now?: Date; suggestions?: boolean } = {}): Promise<RuleLibrary> {
  const now = options.now ?? new Date()
  const [rules, { chart }, recent] = await Promise.all([
    listRules(companyId),
    loadActiveChart(companyId),
    options.suggestions === false ? null : recentTransactions(companyId, now),
  ])
  const existing = existingRulesOf(rules)
  const templates = RULE_TEMPLATES.map((t) => templateView(t, mapRuleAccounts(t.lines, chart, PCG_LABELS), existing))
  const installed = new Set(templates.filter((t) => t.status.installed).map((t) => t.id))
  const enabled = existing.filter((r) => r.enabled !== false)
  const run = recent ? rankTemplateSuggestions(RULE_TEMPLATES, recent.rows, enabled, { exclude: installed }) : { suggestions: [], analyzed: 0, covered: 0 }
  const names = new Map(RULE_TEMPLATES.map((t) => [t.id, t.name]))
  return {
    categories: RULE_TEMPLATE_CATEGORIES,
    templates,
    suggestions: run.suggestions.map((s) => ({ ...s, name: names.get(s.templateId) ?? s.templateId })),
    analysis: {
      since: (recent?.since ?? addUtcDays(todayUtc(now), -SUGGESTION_DAYS)).toISOString().slice(0, 10),
      analyzed: run.analyzed,
      covered: run.covered,
      truncated: recent?.truncated ?? false,
    },
    hasChart: chart.length > 0,
  }
}

function findTemplate(templateId: string): RuleTemplate {
  const template = ruleTemplateById(templateId)
  if (!template) throw new NotFoundError(TEMPLATE_NOT_FOUND_MESSAGE)
  return template
}

/** Rule body of a template, its accounts mapped (null where the chart has nothing that fits). */
function ruleLinesOf(template: RuleTemplate, mapping: RuleMapping, created: ReadonlySet<string> = new Set()) {
  return mapLines(template.lines, mapping, created).map(({ line, accountCode, vatAccountCode, vatAccount2Code }, index) => ({
    accountCode,
    lineType: line.lineType,
    amountType: line.amountType,
    amountValue: line.amountValue ?? null,
    description: line.description ?? null,
    order: index,
    vatType: line.vatType ?? null,
    vatRateSource: line.vatType && line.vatType !== 'none' ? (line.vatRateSource ?? 'fixed') : 'fixed',
    vatRate: line.vatRate ?? null,
    vatAccountCode,
    vatAccount2Code,
    vatOnDebit: false,
  }))
}

function ruleDescription(template: RuleTemplate): string {
  return `${template.description} TVA : ${template.vat.why}`
}

/**
 * The prefill of the rule editor for a template (/rules/new?template=<id>):
 * name, description, conditions and lines with the account ids of the
 * active fiscal year ('' where the chart has nothing that fits), and what
 * the page tells the user (accounts to create, duplicates).
 */
export async function getRuleTemplatePrefill(companyId: string, templateId: string) {
  const template = findTemplate(templateId)
  const [rules, { chart }] = await Promise.all([listRules(companyId), loadActiveChart(companyId)])
  const mapping = mapRuleAccounts(template.lines, chart, PCG_LABELS)
  const idOf = new Map(chart.map((a) => [a.code, a.id]))
  const id = (code: string | null) => (code ? (idOf.get(code) ?? '') : '')
  return {
    template: templateView(template, mapping, existingRulesOf(rules)),
    prefill: {
      name: template.name,
      description: ruleDescription(template),
      journalCode: 'BQ',
      conditions: template.conditions.map(({ conditionType, operator, value, value2 }) => ({ conditionType, operator, value, value2: value2 ?? '' })),
      entryLines: ruleLinesOf(template, mapping).map((line) => ({
        accountId: id(line.accountCode),
        lineType: line.lineType,
        amountType: line.amountType,
        amountValue: line.amountValue ?? undefined,
        description: line.description ?? undefined,
        vatType: line.vatType ?? 'none',
        vatRateSource: line.vatRateSource,
        vatRate: line.vatRate ?? undefined,
        vatAccountId: id(line.vatAccountCode) || undefined,
        vatAccount2Id: id(line.vatAccount2Code) || undefined,
      })),
    },
  }
}

/**
 * Creates accounts the chart lacks, in the active fiscal year, each under
 * the existing account it subdivides (PCG art. 932-1). Only the proposals
 * of a mapping: never a code the caller made up.
 */
export async function createProposedAccounts(companyId: string, proposals: readonly AccountProposal[], chart: readonly ChartAccount[], fiscalYearId: string): Promise<string[]> {
  const idOf = new Map(chart.map((a) => [a.code, a.id]))
  const created: string[] = []
  // Shortest codes first: a new account may be the parent of the next one.
  for (const proposal of [...proposals].sort((a, b) => a.code.length - b.code.length)) {
    const parentId = idOf.get(proposal.parentCode)
    if (!parentId) continue
    const account = await createAccount(companyId, { code: proposal.code, label: proposal.label, parentId, fiscalYearId })
    idOf.set(account.code, account.id)
    created.push(account.code)
  }
  return created
}

/** Creates the accounts a template needs that the company's chart lacks (the "Créer les comptes" button). */
export async function createTemplateAccounts(companyId: string, templateId: string): Promise<{ created: string[] }> {
  const template = findTemplate(templateId)
  const { fiscalYear, chart } = await loadActiveChart(companyId)
  if (!fiscalYear) throw new ValidationError(NO_FISCAL_YEAR_MESSAGE)
  const mapping = mapRuleAccounts(template.lines, chart, PCG_LABELS)
  return { created: await createProposedAccounts(companyId, mapping.missing, chart, fiscalYear.id) }
}

export interface AddRuleFromTemplateInput {
  /** Create the accounts the chart lacks; otherwise the parent account is used, and a code without one is refused. */
  createMissingAccounts?: boolean
  /** Add the rule even when the same rule exists (same name or same conditions). */
  allowDuplicate?: boolean
  name?: string
  enabled?: boolean
  autoCreate?: boolean
  priority?: number
}

/** Adds the rule of a template to the company, its accounts mapped to the chart (add_rule_from_template). */
export async function addRuleFromTemplate(companyId: string, templateId: string, input: AddRuleFromTemplateInput = {}) {
  const template = findTemplate(templateId)
  const [rules, { fiscalYear, chart }] = await Promise.all([listRules(companyId), loadActiveChart(companyId)])
  if (!fiscalYear) throw new ValidationError(NO_FISCAL_YEAR_MESSAGE)
  const name = input.name?.trim() || template.name
  const status = duplicateStatus({ name, conditions: template.conditions, sampleLabels: template.samples.match, side: sideOf(template) }, existingRulesOf(rules))
  if (status.installed && !input.allowDuplicate) {
    throw new ConflictError(
      `La règle « ${status.installed.ruleName} » existe déjà (${status.installed.reason === 'name' ? 'même nom' : 'mêmes conditions'}) : modifiez-la, ou ajoutez le modèle avec allowDuplicate.`,
    )
  }
  const mapping = mapRuleAccounts(template.lines, chart, PCG_LABELS)
  const created = new Set(input.createMissingAccounts ? await createProposedAccounts(companyId, mapping.missing, chart, fiscalYear.id) : [])
  const lines = ruleLinesOf(template, mapping, created)
  const unmapped = lines.flatMap((l, i) => {
    const original = template.lines[i]
    const codes: string[] = []
    if (!l.accountCode) codes.push(original.accountCode)
    if (original.vatAccountCode && !l.vatAccountCode) codes.push(original.vatAccountCode)
    if (original.vatAccount2Code && !l.vatAccount2Code) codes.push(original.vatAccount2Code)
    return codes
  })
  if (unmapped.length > 0) {
    throw new ValidationError(
      `Le plan de comptes de l'exercice ${fiscalYear.year} n'a aucun compte pour ${[...new Set(unmapped)].join(', ')} : créez ${unmapped.length > 1 ? 'ces comptes' : 'ce compte'}, ou ajoutez le modèle avec createMissingAccounts.`,
    )
  }
  const rule = await createRule(companyId, {
    name,
    description: ruleDescription(template),
    enabled: input.enabled ?? true,
    priority: input.priority ?? 0,
    journalCode: 'BQ',
    autoCreate: input.autoCreate ?? false,
    conditions: template.conditions.map(({ conditionType, operator, value, value2 }) => ({ conditionType, operator, value, value2: value2 ?? null })),
    entryLines: lines.map((l) => ({ ...l, accountCode: l.accountCode as string })),
  })
  return {
    rule,
    templateId: template.id,
    createdAccounts: [...created],
    fallbacks: mapping.accounts.flatMap((a) => (a.status === 'missing' && !created.has(a.code) && a.fallback ? [{ code: a.code, used: a.fallback.code }] : [])),
    nearDuplicates: status.nearDuplicates,
  }
}
