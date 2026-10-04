import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfExpenseReport } from '@/lib/api/resources'
import { routeActor } from '@/lib/expense-reports/actor'
import { runExpenseWorkflow, WorkflowBodySchema } from '@/lib/expense-reports/manage-expense-reports.service'

/**
 * POST /api/expense-reports/[id]/workflow { action: submit | return | validate | reopen, note? }
 * submit: its author or a validator; return (with a note), validate, reopen:
 * a validator (expenses:validate), checked in the service with the report's state.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfExpenseReport), permission: { expenses: ['submit'] }, body: WorkflowBodySchema },
  async (ctx) => {
    if (ctx.body.action !== 'submit') ctx.authorize({ expenses: ['validate'] })
    return NextResponse.json(await runExpenseWorkflow(ctx.companyId, ctx.params.id as string, ctx.body, routeActor(ctx)))
  },
)
