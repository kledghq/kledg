import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody } from '@/lib/api/route'
import { writeAuditLog } from '@/lib/audit'
import { deleteNonPcgAccounts } from '@/lib/accounting/delete-accounts.service'

const DeleteNonPcgBody = z.object({ fiscalYearId: z.string().nullish() })

/**
 * POST { companyId, fiscalYearId? }: deletes the accounts of the chart that
 * are not PCG accounts. 409 with `accountsWithEntries` when some of them
 * hold entries (nothing is deleted then).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: DeleteNonPcgBody },
  async ({ companyId, body }) => {
    const result = await deleteNonPcgAccounts(companyId, body.fiscalYearId)

    if (result.deletedCount > 0) {
      await writeAuditLog('info', `Deleted ${result.deletedCount} non-PCG account(s)`, {
        action: 'DELETE_NON_PCG_ACCOUNTS',
        companyId,
        metadata: { deletedCount: result.deletedCount },
      })
    }

    return NextResponse.json(result)
  },
)
