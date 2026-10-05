/**
 * The catalog of the rules library: every template, in the order of the
 * categories (RULE_TEMPLATE_CATEGORIES). Checked as a whole by
 * lib/rules-library/__tests__/catalog.test.ts.
 */

import { RULE_TEMPLATE_CATEGORIES, type RuleTemplate } from '../template'
import { FINANCE_TEMPLATES } from './finance'
import { SERVICES_TEMPLATES } from './services'
import { TRAVEL_TEMPLATES } from './travel'

const order = new Map<string, number>(RULE_TEMPLATE_CATEGORIES.map((c, index) => [c.id, index]))

export const RULE_TEMPLATES: readonly RuleTemplate[] = [...FINANCE_TEMPLATES, ...SERVICES_TEMPLATES, ...TRAVEL_TEMPLATES].sort(
  (a, b) => (order.get(a.category) ?? 0) - (order.get(b.category) ?? 0),
)

const byId = new Map(RULE_TEMPLATES.map((t) => [t.id, t]))

export function ruleTemplateById(id: string): RuleTemplate | undefined {
  return byId.get(id)
}
