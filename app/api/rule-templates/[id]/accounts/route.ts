import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { createTemplateAccounts } from '@/lib/rules-library/manage-rule-templates.service'

/**
 * POST /api/rule-templates/[id]/accounts: creates, in the active fiscal
 * year, the accounts a template needs that the company's chart lacks, each
 * under the account it subdivides. Asked by the user on the library page
 * before the rule editor opens; never done silently.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: z.object({ companyId: z.string() }) },
  async ({ companyId, params }) => {
    const result = await createTemplateAccounts(companyId, params.id as string)
    if (result.created.length > 0) {
      await writeAuditLog('info', `Accounts created for rule template ${params.id as string}: ${result.created.join(', ')}`, {
        action: 'CREATE_RULE_TEMPLATE_ACCOUNTS',
        companyId,
        metadata: { templateId: params.id, codes: result.created },
      })
    }
    return NextResponse.json(result, { status: result.created.length > 0 ? 201 : 200 })
  },
)
