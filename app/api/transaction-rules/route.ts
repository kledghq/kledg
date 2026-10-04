import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { createRule, findRulePatternIssues, listRules, RuleInputSchema } from '@/lib/transactions/manage-rules.service'

/**
 * GET /api/transaction-rules: the company's assignment rules (règles d'affectation), highest priority first,
 * and `patternIssues`: regex conditions saved before patterns were checked that the matcher refuses.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => {
    const rules = await listRules(companyId)
    return NextResponse.json({ rules, patternIssues: findRulePatternIssues(rules) })
  },
)

/**
 * POST /api/transaction-rules: creates a rule.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: RuleInputSchema },
  async ({ companyId, body }) => {
    const rule = await createRule(companyId, body)

    await writeAuditLog('info', `Transaction rule created: ${rule.name}`, {
      action: 'CREATE_TRANSACTION_RULE',
      companyId,
      metadata: {
        ruleId: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        priority: rule.priority,
        journalCode: rule.journalCode,
        conditionsCount: rule.conditions.length,
        entryLinesCount: rule.entryLines.length,
      },
    })

    return NextResponse.json({ rule })
  },
)
