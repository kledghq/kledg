/**
 * "Suggérées pour vous": templates ranked by how many recent bank
 * transactions of the company they would recognise that no rule of the
 * company recognises yet. Pure: the service loads the transactions (last
 * 12 months, capped) and the rules, this module matches them in one pass.
 *
 * Cost: one pass over the transactions; for each, the company's enabled
 * rules first (a covered transaction stops there), then the templates, with
 * the matcher of the rules engine (lib/transactions/rule-matcher.ts: regex
 * conditions run in linear time with a step budget per transaction).
 * Templates put their side condition first, so a debit template stops at
 * once on a credit.
 */

import { findMatchingRules, type MatchableRule, type MatchableTransaction } from '@/lib/transactions/rule-matcher'
import type { RuleTemplate } from './template'

export interface TemplateSuggestion {
  templateId: string
  /** Transactions the template recognises that no rule of the company recognises. */
  matchCount: number
  /** Label of the most recent of them, to show what was recognised. */
  example: string | null
}

export interface SuggestionRun {
  suggestions: TemplateSuggestion[]
  /** Transactions read. */
  analyzed: number
  /** Of which already recognised by a rule of the company. */
  covered: number
}

/** A template as the matcher reads a rule. */
export function templateAsRule(template: Pick<RuleTemplate, 'id' | 'name' | 'conditions'>): MatchableRule {
  return {
    id: template.id,
    name: template.name,
    priority: 0,
    autoCreate: false,
    conditions: template.conditions.map((c) => ({ conditionType: c.conditionType, operator: c.operator, value: c.value, value2: c.value2 ?? null })),
  }
}

/**
 * Ranks templates by uncovered matches (most first, then by name), leaving
 * out the templates in `exclude` (already installed) and those that match
 * nothing. Transactions are expected newest first.
 */
export function rankTemplateSuggestions(
  templates: ReadonlyArray<Pick<RuleTemplate, 'id' | 'name' | 'conditions'>>,
  transactions: readonly MatchableTransaction[],
  rules: readonly MatchableRule[],
  options: { exclude?: ReadonlySet<string>; limit?: number } = {},
): SuggestionRun {
  const candidates = templates.filter((t) => !options.exclude?.has(t.id)).map(templateAsRule)
  const counts = new Map<string, { matchCount: number; example: string | null }>()
  let covered = 0
  for (const transaction of transactions) {
    if (rules.length > 0 && findMatchingRules(rules, transaction).length > 0) {
      covered++
      continue
    }
    for (const match of findMatchingRules(candidates, transaction)) {
      const current = counts.get(match.ruleId)
      if (current) current.matchCount++
      else counts.set(match.ruleId, { matchCount: 1, example: transaction.label ?? null })
    }
  }
  const names = new Map(templates.map((t) => [t.id, t.name]))
  const suggestions = [...counts.entries()]
    .map(([templateId, value]) => ({ templateId, ...value }))
    .sort((a, b) => b.matchCount - a.matchCount || (names.get(a.templateId) ?? '').localeCompare(names.get(b.templateId) ?? '', 'fr'))
    .slice(0, options.limit ?? 12)
  return { suggestions, analyzed: transactions.length, covered }
}
