import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { ensureDefaultJournals } from '@/lib/accounting/default-journals'
import { listJournals } from '@/lib/accounting/manage-journals.service'

/**
 * Adds back the default journals (AC, VE, BQ, OD, AN) the company is missing,
 * from the Journaux page. Existing journals are left as they are.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] } },
  async ({ companyId }) => {
    const created = await ensureDefaultJournals(companyId)
    return NextResponse.json({ created, journals: await listJournals(companyId) })
  },
)
