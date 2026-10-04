import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfAccount } from '@/lib/api/resources'
import { ownedAccount } from '@/lib/accounting/manage-accounts.service'
import { getAccountBalanceEvolution } from '@/lib/reports/account-balance-evolution'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'

/** Monthly debits, credits and cumulative balance of the account over its fiscal year. */
export const GET = companyRoute(
  { company: fromResource(companyOfAccount), permission: { entries: ['read'] } },
  async ({ params, companyId }) => {
    const account = await ownedAccount(companyId, params.id as string, { id: true })
    return NextResponse.json(await getAccountBalanceEvolution(account.id), { headers: NO_CACHE_HEADERS })
  },
)
