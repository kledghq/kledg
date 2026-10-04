import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfAccount } from '@/lib/api/resources'
import { writeAuditLog } from '@/lib/audit'
import { getAccount, updateAccount } from '@/lib/accounting/manage-accounts.service'
import { deleteAccount } from '@/lib/accounting/delete-accounts.service'

export const GET = companyRoute(
  { company: fromResource(companyOfAccount), permission: { entries: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getAccount(companyId, params.id as string)),
)

/**
 * Deletes an account and its sub-accounts. 409 for a PCG account, or when
 * the account or a sub-account is a PCG account or holds entries.
 */
export const DELETE = companyRoute(
  { company: fromResource(companyOfAccount), permission: { ledger: ['manage'] } },
  async ({ params, companyId }) => {
    const account = await deleteAccount(companyId, params.id as string)

    await writeAuditLog('info', `Account deleted: ${account.code} - ${account.label}`, {
      action: 'DELETE_ACCOUNT',
      companyId,
      metadata: { accountId: account.id, code: account.code, label: account.label },
    })

    return NextResponse.json({ success: true, message: 'Compte supprimé avec succès' })
  },
)

const UpdateAccountBody = z.object({
  code: z.string({ error: 'Le code doit être un texte' }).optional(),
  label: z.string({ error: 'Le libellé est requis' }).optional(),
  parentId: z.string({ error: 'Compte parent invalide' }).nullable().optional(),
})

/** Number (not for a PCG account), label or parent ('none' or null detaches it). */
export const PATCH = companyRoute(
  { company: fromResource(companyOfAccount), permission: { ledger: ['manage'] }, body: UpdateAccountBody },
  async ({ params, companyId, body }) => {
    const { before, account } = await updateAccount(companyId, params.id as string, body)

    await writeAuditLog('info', `Account updated: ${account.code} - ${account.label}`, {
      action: 'UPDATE_ACCOUNT',
      companyId,
      metadata: {
        accountId: account.id,
        oldCode: before.code,
        newCode: account.code,
        oldLabel: before.label,
        newLabel: account.label,
      },
    })

    return NextResponse.json(account)
  },
)
