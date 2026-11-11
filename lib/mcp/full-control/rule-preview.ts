/**
 * What the dry run of a bulk rule application shows the person who approves
 * it (run_rules, sync_bank_data refresh): each rule that would apply, the
 * accounts it books to, how many transactions it takes, and whether an
 * assistant created or changed it, and when. A count alone would hide a rule
 * an assistant created a minute before asking for the run.
 *
 * The assistant changes are read from the audit log of the company: every
 * full control or draft-level call that creates or changes a rule writes one
 * entry with its rule id (define.ts, drafts/define.ts).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Tools that create or change a rule, and the audit key of the rule ids they wrote. */
const RULE_TOOLS: Record<string, 'created' | 'changed'> = {
  create_rule: 'created',
  add_rule_from_template: 'created',
  copy_rules_from_company: 'created',
  duplicate_rule: 'created',
  update_rule: 'changed',
}

/** Rules listed at most in one dry run (the total is always given). */
export const MAX_PREVIEW_RULES = 50

export interface AssistantChange {
  change: 'created' | 'changed'
  tool: string
  /** Name of the assistant (OAuth client or API key) as recorded, or its id. */
  assistant: string | null
  at: string
}

export interface RulePreview {
  ruleId: string
  name: string
  journalCode: string
  autoCreate: boolean
  /** Accounts of its entry lines, VAT accounts included, in line order. */
  accounts: string[]
  /** Transactions this run would book with it. */
  transactions: number
  /** The last change of the rule by an assistant connection, null when none is recorded. */
  byAssistant: AssistantChange | null
}

interface AuditRow {
  ruleId: string | null
  ruleIds: unknown
  tool: string
  assistantName: string | null
  assistantId: string | null
  createdAt: Date
}

/** The last assistant change of each rule among `ruleIds`, from the audit log of the company. */
export async function assistantRuleChanges(companyId: string, ruleIds: readonly string[]): Promise<Map<string, AssistantChange>> {
  const changes = new Map<string, AssistantChange>()
  if (ruleIds.length === 0) return changes
  const ids = [...ruleIds]
  const rows = await prisma.$queryRaw<AuditRow[]>`
    SELECT "metadata"->>'ruleId' AS "ruleId", "metadata"->'ruleIds' AS "ruleIds", "metadata"->>'tool' AS "tool",
           "metadata"->'assistant'->>'name' AS "assistantName", "metadata"->'assistant'->>'id' AS "assistantId", "createdAt"
    FROM "audit_logs"
    WHERE "companyId" = ${companyId}
      AND "action" IN ('MCP_FULL_CONTROL', 'MCP_WRITE')
      AND "metadata"->>'tool' IN (${Prisma.join(Object.keys(RULE_TOOLS))})
      AND ("metadata"->>'ruleId' = ANY(${ids}) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof("metadata"->'ruleIds') = 'array' THEN "metadata"->'ruleIds' ELSE '[]'::jsonb END) AS r(id)
        WHERE r.id = ANY(${ids})
      ))
    ORDER BY "createdAt" DESC
    LIMIT 1000`
  for (const row of rows) {
    const touched = [row.ruleId, ...(Array.isArray(row.ruleIds) ? row.ruleIds : [])].filter((id): id is string => typeof id === 'string' && ids.includes(id))
    for (const id of touched) {
      if (changes.has(id)) continue
      changes.set(id, { change: RULE_TOOLS[row.tool] ?? 'changed', tool: row.tool, assistant: row.assistantName ?? row.assistantId, at: row.createdAt.toISOString() })
    }
  }
  return changes
}

/** The rules that would apply, most transactions first, with their accounts and their assistant changes. */
export async function rulesPreview(
  companyId: string,
  countByRule: Readonly<Record<string, number>>,
): Promise<{ total: number; listed: RulePreview[]; byAssistant: number }> {
  const ids = Object.keys(countByRule)
  if (ids.length === 0) return { total: 0, listed: [], byAssistant: 0 }
  const [rules, changes] = await Promise.all([
    prisma.transactionRule.findMany({
      where: { companyId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        journalCode: true,
        autoCreate: true,
        defaultVatAccountCode: true,
        entryLines: { orderBy: [{ order: 'asc' }, { id: 'asc' }], select: { accountCode: true, vatAccountCode: true, vatAccount2Code: true } },
      },
    }),
    assistantRuleChanges(companyId, ids),
  ])
  const previews: RulePreview[] = rules.map((rule) => {
    const accounts = rule.entryLines.flatMap((l) => [l.accountCode, l.vatAccountCode, l.vatAccount2Code]).filter((c): c is string => Boolean(c))
    return {
      ruleId: rule.id,
      name: rule.name,
      journalCode: rule.journalCode,
      autoCreate: rule.autoCreate,
      accounts: [...new Set(accounts)],
      transactions: countByRule[rule.id] ?? 0,
      byAssistant: changes.get(rule.id) ?? null,
    }
  })
  // Rules changed by an assistant first, then by number of transactions
  previews.sort((a, b) => Number(Boolean(b.byAssistant)) - Number(Boolean(a.byAssistant)) || b.transactions - a.transactions || a.name.localeCompare(b.name))
  return { total: previews.length, listed: previews.slice(0, MAX_PREVIEW_RULES), byAssistant: previews.filter((p) => p.byAssistant).length }
}
