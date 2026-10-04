import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfTransaction } from '@/lib/api/resources'
import { ConfirmExpenseBodySchema, confirmExpense } from '@/lib/simple/confirm-expense.service'

/**
 * POST /api/simple/expenses/[id]/confirm { categoryId?, ruleId?, answers?, note?, learn? }
 * Confirms a simple mode line: creates the entry (bank line, charge or
 * product, VAT) and reconciles the transaction, like the reconciliation
 * dialog. Without categoryId nor ruleId, the suggestion as proposed. The
 * entry stays a draft for the accountant when the company asks for it, and
 * is validated at once otherwise when the user may validate entries.
 * 201; 409 when the transaction is already reconciled; 400 when a question
 * is unanswered (details.question) or the chart lacks the account.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['reconcile'] }, body: ConfirmExpenseBodySchema },
  async ({ params, companyId, body, user, authorize, can }) => {
    authorize({ entries: ['create'] })
    const result = await confirmExpense(companyId, params.id as string, body, {
      userId: user.id,
      canValidate: can({ entries: ['validate'] }),
      source: 'web',
    })
    return NextResponse.json(result, { status: 201 })
  },
)
