import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { selectBankAccount, SelectBankAccountSchema } from '@/lib/banking/select-bank-account.service'

/**
 * Met à jour le compte bancaire sélectionné pour une société.
 * Body: { companyId, accountId } (accountId empty or null clears the selection).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: SelectBankAccountSchema },
  async ({ companyId, body }) => NextResponse.json(await selectBankAccount(companyId, body.accountId)),
)
