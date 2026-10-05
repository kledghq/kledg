/**
 * "Copier depuis une autre société": the rules of the user's other
 * companies, and the copy of some of them into the company of the request,
 * their accounts mapped to its chart (account-mapping.ts).
 *
 * Invariants owned here (the pattern of lib/management-fees/access.ts):
 * - every company touched is checked with the user's own role there, with
 *   the permission the rules routes ask: banking:read to read the rules of
 *   the source (GET /api/transaction-rules), ledger:manage to create them in
 *   the target (POST /api/transaction-rules). Being a member of the target
 *   gives nothing in the source;
 * - the check runs through a GroupAccess: the web route builds it from the
 *   user's roles (userGroupAccess), the MCP tool from its company guard,
 *   which also applies the connection's company grant, so an assistant never
 *   reads a company it was not granted;
 * - each read of a source runs in that company's own row level security
 *   scope (withUserContext narrowed to it, docs/rls.md), never in a system
 *   context; the listing of the candidate companies runs as the user, within
 *   the access's own bound;
 * - a company out of reach answers the 404 of a company that does not
 *   exist, and is never named.
 */

import { prisma } from '@/lib/prisma'
import { COMPANY_NOT_FOUND_MESSAGE, type Permission } from '@/lib/rbac/authorize'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { withUserContext } from '@/lib/rls/context'
import type { GroupAccess } from '@/lib/management-fees/access'
import { createRule, listRules, type RuleWithDetails } from '@/lib/transactions/manage-rules.service'
import { mapLines, mapRuleAccounts, resolvedCode } from './account-mapping'
import { duplicateStatus } from './duplicates'
import { NO_FISCAL_YEAR_MESSAGE, PCG_LABELS, createProposedAccounts, loadActiveChart } from './manage-rule-templates.service'

/** Right needed to read the rules of a company (GET /api/transaction-rules). */
export const READ_RULES: Permission = { banking: ['read'] }
/** Right needed to create rules in a company (POST /api/transaction-rules). */
export const MANAGE_RULES: Permission = { ledger: ['manage'] }

/** Other companies read at most for the list of sources. */
export const MAX_SOURCE_COMPANIES = 30
/** Rules copied at most in one request. */
export const MAX_COPIED_RULES = 100

/** Runs `fn` in the scope of `companyId` after checking `permission` there. */
async function inSource<T>(access: GroupAccess, companyId: string, permission: Permission, fn: () => Promise<T>): Promise<T> {
  return withUserContext(
    access.userId,
    async () => {
      try {
        await access.require(companyId, permission)
      } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
        throw error
      }
      return fn()
    },
    { companyIds: [companyId] },
  )
}

/** Ids of the companies the user is a member of, within the access's bound, archived ones left out. */
async function candidateCompanies(access: GroupAccess, excludeId: string): Promise<Array<{ id: string; name: string }>> {
  const bound = (await access.companyIds?.()) ?? null
  const companies = await withUserContext(access.userId, () =>
    prisma.company.findMany({
      where: {
        archivedAt: null,
        id: bound ? { in: [...bound], not: excludeId } : { not: excludeId },
        organization: { members: { some: { userId: access.userId } } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: MAX_SOURCE_COMPANIES + 1,
    }),
  )
  return companies
}

function summarize(rule: RuleWithDetails) {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    priority: rule.priority,
    autoCreate: rule.autoCreate,
    usageCount: rule.usageCount,
    conditions: rule.conditions.map((c) => ({ conditionType: c.conditionType, operator: c.operator, value: c.value, value2: c.value2 })),
    entryLines: rule.entryLines.map((l) => ({ accountCode: l.accountCode, lineType: l.lineType, amountType: l.amountType, vatType: l.vatType, vatRate: l.vatRate, vatAccountCode: l.vatAccountCode })),
  }
}

export interface CopySources {
  companies: Array<{
    id: string
    name: string
    rules: Array<ReturnType<typeof summarize> & { status: ReturnType<typeof duplicateStatus> }>
  }>
  /** Companies where the user's role does not allow reading rules: counted, not read. */
  unreadable: number
  /** Companies beyond MAX_SOURCE_COMPANIES, not read. */
  truncated: boolean
}

/**
 * Rules of the user's other companies where the user may read rules, each
 * with its duplicate status against the target's rules.
 */
export async function listCopySources(access: GroupAccess, targetCompanyId: string): Promise<CopySources> {
  const targetRules = await listRules(targetCompanyId)
  const candidates = await candidateCompanies(access, targetCompanyId)
  const companies: CopySources['companies'] = []
  let unreadable = 0
  // One company after the other, each in its own scope: a handful of companies.
  for (const company of candidates.slice(0, MAX_SOURCE_COMPANIES)) {
    try {
      const rules = await inSource(access, company.id, READ_RULES, () => listRules(company.id))
      if (rules.length === 0) continue
      companies.push({
        id: company.id,
        name: company.name,
        rules: rules.map((rule) => ({ ...summarize(rule), status: duplicateStatus({ name: rule.name, conditions: rule.conditions }, targetRules) })),
      })
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError) unreadable++
      else throw error
    }
  }
  return { companies, unreadable, truncated: candidates.length > MAX_SOURCE_COMPANIES }
}

export interface CopyRulesInput {
  sourceCompanyId: string
  ruleIds: string[]
  /** Create the accounts the target's chart lacks; otherwise the parent account is used, and a rule with an account that has neither is skipped. */
  createMissingAccounts?: boolean
  /** Copied rules are inactive unless asked: their accounts are checked first. */
  enabled?: boolean
}

export interface CopyRulesResult {
  copied: Array<{ sourceRuleId: string; ruleId: string; name: string }>
  skipped: Array<{ sourceRuleId: string; name: string; reason: string }>
  createdAccounts: string[]
  fallbacks: Array<{ code: string; used: string }>
}

/**
 * Copies rules of a source company into the target. The caller checked
 * ledger:manage in the target (route or MCP tool); it is checked again here,
 * with banking:read in the source. A rule with the same name or the same
 * conditions as a rule of the target is skipped.
 */
export async function copyRulesFromCompany(access: GroupAccess, targetCompanyId: string, input: CopyRulesInput): Promise<CopyRulesResult> {
  if (input.sourceCompanyId === targetCompanyId) throw new ValidationError('Choisissez une autre société que celle où vous copiez les règles.')
  const ruleIds = [...new Set(input.ruleIds)]
  if (ruleIds.length === 0) throw new ValidationError('Choisissez au moins une règle à copier.')
  if (ruleIds.length > MAX_COPIED_RULES) throw new ValidationError(`Copiez au plus ${MAX_COPIED_RULES} règles à la fois.`)
  await access.require(targetCompanyId, MANAGE_RULES)

  const source = await inSource(access, input.sourceCompanyId, READ_RULES, async () => {
    const [rules, { chart }] = await Promise.all([listRules(input.sourceCompanyId), loadActiveChart(input.sourceCompanyId)])
    return { rules: rules.filter((r) => ruleIds.includes(r.id)), labels: chart }
  })
  if (source.rules.length !== ruleIds.length) throw new NotFoundError('Règle introuvable')

  const [targetRules, { fiscalYear, chart }] = await Promise.all([listRules(targetCompanyId), loadActiveChart(targetCompanyId)])
  if (!fiscalYear) throw new ValidationError(NO_FISCAL_YEAR_MESSAGE)
  // Labels of the accounts to create: the source's own label for its subdivisions, else the PCG label.
  const labels = new Map(PCG_LABELS)
  for (const account of source.labels) if (!labels.has(account.code)) labels.set(account.code, account.label)

  const result: CopyRulesResult = { copied: [], skipped: [], createdAccounts: [], fallbacks: [] }
  const known = targetRules.map((r) => ({ id: r.id, name: r.name, priority: r.priority, autoCreate: r.autoCreate, conditions: r.conditions }))
  let currentChart = chart
  for (const rule of source.rules) {
    const status = duplicateStatus({ name: rule.name, conditions: rule.conditions }, known)
    if (status.installed) {
      result.skipped.push({ sourceRuleId: rule.id, name: rule.name, reason: `Déjà présente : « ${status.installed.ruleName} » (${status.installed.reason === 'name' ? 'même nom' : 'mêmes conditions'}).` })
      continue
    }
    // Copied codes keep their exact account first (mode 'copy'), a company's own subdivisions included.
    const lines = rule.entryLines
    const mapping = mapRuleAccounts(lines, currentChart, labels, rule.defaultVatAccountCode, 'copy')
    let created = new Set<string>()
    if (input.createMissingAccounts && mapping.missing.length > 0) {
      const codes = await createProposedAccounts(targetCompanyId, mapping.missing, currentChart, fiscalYear.id)
      result.createdAccounts.push(...codes)
      created = new Set(codes)
      currentChart = (await loadActiveChart(targetCompanyId)).chart
    }
    const mapped = mapLines(lines, mapping, created, 'copy')
    const unmapped = mapped.some((m) => !m.accountCode || (m.line.vatAccountCode && !m.vatAccountCode) || (m.line.vatAccount2Code && !m.vatAccount2Code))
    if (unmapped) {
      result.skipped.push({ sourceRuleId: rule.id, name: rule.name, reason: 'Un compte de la règle manque au plan de comptes et ne peut pas être créé : créez-le, puis copiez la règle.' })
      continue
    }
    for (const a of mapping.accounts) if (a.status === 'missing' && !created.has(a.code) && a.fallback) result.fallbacks.push({ code: a.code, used: a.fallback.code })
    const copy = await createRule(targetCompanyId, {
      name: rule.name,
      description: rule.description,
      enabled: input.enabled ?? false,
      priority: rule.priority,
      journalCode: rule.journalCode,
      defaultVatAccountCode: rule.defaultVatAccountCode ? resolvedCode(mapping, { code: rule.defaultVatAccountCode, kind: 'exact' }, created) : null,
      autoCreate: rule.autoCreate,
      conditions: rule.conditions.map((c) => ({ conditionType: c.conditionType, operator: c.operator, value: c.value, value2: c.value2 })),
      entryLines: mapped.map(({ line, accountCode, vatAccountCode, vatAccount2Code }) => ({
        accountCode: accountCode as string,
        lineType: line.lineType,
        amountType: line.amountType,
        amountValue: line.amountValue != null ? Number(line.amountValue) : null,
        description: line.description,
        order: line.order,
        vatType: line.vatType,
        vatRateSource: line.vatRateSource,
        vatRate: line.vatRate != null ? Number(line.vatRate) : null,
        vatAccountCode,
        vatAccount2Code,
        vatOnDebit: line.vatOnDebit,
      })),
    })
    known.push({ id: copy.id, name: copy.name, priority: copy.priority, autoCreate: copy.autoCreate, conditions: copy.conditions })
    result.copied.push({ sourceRuleId: rule.id, ruleId: copy.id, name: copy.name })
  }
  return result
}
