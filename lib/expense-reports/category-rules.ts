/**
 * Automatic category of an expense line from the company's keyword rules.
 * Pure module: the line editor proposes the category as the supplier is
 * typed, the server applies the same rule to a line sent without category
 * (MCP tool, import).
 *
 * A rule is a keyword, matched without case nor accents as a substring of
 * the supplier name or the label: "sncf" matches "SNCF Voyageurs". The
 * highest priority wins, then the longest keyword (the most specific). No
 * pattern is ever compiled to a regular expression (docs/conventions.md,
 * Security: user-written patterns never reach new RegExp).
 *
 * Kledg's transaction rules (lib/transactions) match bank transactions on
 * many fields and write entries; expense lines only need a category, so a
 * plain mapping per company is enough and stays predictable.
 */

import type { ExpenseCategory } from './categories'

export interface CategoryRule {
  id: string
  keyword: string
  category: ExpenseCategory
  accountCode: string | null
  priority: number
}

/** Lower case without accents nor repeated spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchCategoryRule(rules: readonly CategoryRule[], line: { supplierName?: string | null; label?: string | null }): CategoryRule | null {
  const haystack = normalizeText(`${line.supplierName ?? ''} ${line.label ?? ''}`)
  if (!haystack) return null
  const matches = rules.filter((rule) => {
    const keyword = normalizeText(rule.keyword)
    return keyword.length > 0 && haystack.includes(keyword)
  })
  matches.sort((a, b) => b.priority - a.priority || normalizeText(b.keyword).length - normalizeText(a.keyword).length)
  return matches[0] ?? null
}
