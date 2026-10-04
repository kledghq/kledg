import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { createAccount } from '@/lib/accounting/create-account.service'
import { listAccounts } from '@/lib/accounting/manage-accounts.service'

const ListAccountsQuery = z.object({ fiscalYearId: z.string().optional() })

/** Accounts of a fiscal year chart (?fiscalYearId=, the active fiscal year by default), by number. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: ListAccountsQuery },
  async ({ companyId, query }) => NextResponse.json(await listAccounts(companyId, query.fiscalYearId)),
)

/** Code, label and parent are checked by the service (French messages). */
const CreateAccountBody = z.object({
  code: z.string({ error: 'Le code est requis' }),
  label: z.string({ error: 'Le libellé est requis' }),
  parentId: z.string({ error: 'Le compte parent est requis' }),
  fiscalYearId: z.string().nullish(),
})

export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: CreateAccountBody },
  async ({ companyId, body }) => {
    const account = await createAccount(companyId, body)

    await writeAuditLog('info', `Account created: ${account.code} - ${account.label}`, {
      action: 'CREATE_ACCOUNT',
      companyId,
      metadata: { accountId: account.id, code: account.code, label: account.label, parentId: body.parentId, fiscalYearId: account.fiscalYearId },
    })

    return NextResponse.json(account, { status: 201 })
  },
)
