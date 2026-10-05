import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { userGroupAccess } from '@/lib/management-fees/access'
import { MAX_COPIED_RULES, copyRulesFromCompany, listCopySources } from '@/lib/rules-library/copy-rules.service'

/**
 * GET /api/transaction-rules/copy?companyId=: the rules of the user's other
 * companies where the user may read rules (banking:read in each), for
 * "Copier depuis une autre société".
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId, user }) => NextResponse.json(await listCopySources(userGroupAccess(user), companyId)),
)

const CopyRulesBody = z.object({
  companyId: z.string(),
  sourceCompanyId: z.string().min(1).max(64),
  ruleIds: z.array(z.string().min(1).max(64)).min(1, 'Choisissez au moins une règle à copier.').max(MAX_COPIED_RULES),
  createMissingAccounts: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

/**
 * POST /api/transaction-rules/copy: copies rules of another company of the
 * user (banking:read there) into this one (ledger:manage here), their
 * accounts mapped to this company's chart.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: CopyRulesBody },
  async ({ companyId, user, body }) => {
    const input = { sourceCompanyId: body.sourceCompanyId, ruleIds: body.ruleIds, createMissingAccounts: body.createMissingAccounts, enabled: body.enabled }
    const result = await copyRulesFromCompany(userGroupAccess(user), companyId, input)
    await writeAuditLog('info', `Transaction rules copied from another company: ${result.copied.length}`, {
      action: 'COPY_TRANSACTION_RULES',
      companyId,
      metadata: {
        sourceCompanyId: input.sourceCompanyId,
        copiedRuleIds: result.copied.map((c) => c.ruleId),
        skipped: result.skipped.length,
        createdAccounts: result.createdAccounts,
      },
    })
    return NextResponse.json(result, { status: result.copied.length > 0 ? 201 : 200 })
  },
)
