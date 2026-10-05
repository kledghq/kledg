/**
 * Whether a template (or a rule copied from another company) is already
 * among the rules of the company. Pure.
 *
 * - installed: a rule has the same name (accents, case and punctuation
 *   ignored) or exactly the same conditions;
 * - near duplicate: a rule that is not the same but would already
 *   recognise the bank labels of the template (its samples), or has the
 *   same name once the part in parentheses is left out ("Orange" for
 *   "Orange (télécom)"). The page warns; adding stays possible.
 */

import { findMatchingRules, type MatchableRule, type MatchableTransaction } from '@/lib/transactions/rule-matcher'
import type { RuleTemplate } from './template'

export interface ExistingRule {
  id: string
  name: string
  enabled?: boolean
  priority: number
  autoCreate: boolean
  conditions: Array<{ conditionType: string; operator: string; value: string | null; value2: string | null }>
}

export interface RuleRef {
  ruleId: string
  ruleName: string
}

export interface DuplicateStatus {
  installed: (RuleRef & { reason: 'name' | 'conditions' }) | null
  nearDuplicates: Array<RuleRef & { reason: 'labels' | 'name' }>
}

/** A name compared without accents, case, punctuation nor extra spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The name without its part in parentheses: "Orange (télécom)" gives "orange". */
function baseName(name: string): string {
  return normalizeName(name.replace(/\([^)]*\)/g, ' '))
}

/** The conditions as a set, order and case of the values ignored. */
export function conditionsKey(conditions: ReadonlyArray<{ conditionType: string; operator: string; value?: string | null; value2?: string | null }>): string {
  return conditions
    .map((c) => [c.conditionType, c.operator, (c.value ?? '').trim().toLowerCase(), (c.value2 ?? '').trim().toLowerCase()].join('\u0001'))
    .sort()
    .join('\u0002')
}

/** A bank transaction made of a sample label, on the side the template expects. */
export function sampleTransaction(label: string, side: string): MatchableTransaction {
  return {
    label,
    reference: null,
    counterpartyName: null,
    category: null,
    cashflowCategory: null,
    cashflowSubcategory: null,
    operationType: null,
    side,
    status: null,
    amount: 100,
  }
}

/** The side a template's conditions ask for ('debit' when they do not say). */
export function sideOf(template: Pick<RuleTemplate, 'conditions'>): string {
  return template.conditions.find((c) => c.conditionType === 'side')?.value ?? 'debit'
}

function asMatchable(rule: ExistingRule): MatchableRule {
  return { id: rule.id, name: rule.name, priority: rule.priority, autoCreate: rule.autoCreate, conditions: rule.conditions.map((c) => ({ ...c, value2: c.value2 ?? null })) }
}

/** Duplicate status of a rule to add (template or copied rule) against the company's rules. */
export function duplicateStatus(
  candidate: { name: string; conditions: RuleTemplate['conditions'] | ExistingRule['conditions']; sampleLabels?: readonly string[]; side?: string },
  rules: readonly ExistingRule[],
): DuplicateStatus {
  const name = normalizeName(candidate.name)
  const key = conditionsKey(candidate.conditions)
  const byName = rules.find((r) => normalizeName(r.name) === name)
  const byConditions = rules.find((r) => r.conditions.length > 0 && conditionsKey(r.conditions) === key)
  const installed = byName
    ? { ruleId: byName.id, ruleName: byName.name, reason: 'name' as const }
    : byConditions
      ? { ruleId: byConditions.id, ruleName: byConditions.name, reason: 'conditions' as const }
      : null

  const nearDuplicates: DuplicateStatus['nearDuplicates'] = []
  const others = rules.filter((r) => r.id !== installed?.ruleId)
  if (candidate.sampleLabels?.length) {
    const matchable = others.map(asMatchable)
    const hits = new Set<string>()
    for (const label of candidate.sampleLabels) {
      for (const match of findMatchingRules(matchable, sampleTransaction(label, candidate.side ?? 'debit'))) hits.add(match.ruleId)
    }
    for (const rule of others) if (hits.has(rule.id)) nearDuplicates.push({ ruleId: rule.id, ruleName: rule.name, reason: 'labels' })
  }
  const base = baseName(candidate.name)
  for (const rule of others) {
    if (nearDuplicates.some((d) => d.ruleId === rule.id)) continue
    if (base && baseName(rule.name) === base) nearDuplicates.push({ ruleId: rule.id, ruleName: rule.name, reason: 'name' })
  }
  return { installed, nearDuplicates }
}
