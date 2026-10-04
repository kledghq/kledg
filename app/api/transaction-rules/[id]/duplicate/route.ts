import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfRule } from '@/lib/api/resources'
import { writeAuditLog } from '@/lib/audit'
import { duplicateRule } from '@/lib/transactions/manage-rules.service'

/**
 * POST /api/transaction-rules/[id]/duplicate: copies a rule, disabled.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfRule), permission: { ledger: ['manage'] } },
  async ({ params, companyId }) => {
    const { original, copy } = await duplicateRule(companyId, params.id as string)

    await writeAuditLog('info', `Transaction rule duplicated: ${copy.name}`, {
      action: 'DUPLICATE_TRANSACTION_RULE',
      companyId,
      metadata: {
        originalRuleId: original.id,
        duplicatedRuleId: copy.id,
        name: copy.name,
        conditionsCount: original.conditions.length,
        entryLinesCount: original.entryLines.length,
      },
    })

    return NextResponse.json({ rule: copy })
  },
)
