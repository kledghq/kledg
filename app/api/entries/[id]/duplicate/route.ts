import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfEntry } from '@/lib/api/resources'
import { duplicateEntry } from '@/lib/accounting/services'
import { writeAuditLog } from '@/lib/audit'

/**
 * Duplicates an accounting entry as a new draft and returns the new entry.
 * Used to open the duplicate in edit mode.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfEntry), permission: { entries: ['create'] } },
  async ({ params, companyId }) => {
    const sourceEntryId = params.id as string
    const newEntry = await duplicateEntry(companyId, sourceEntryId)

    await writeAuditLog('info', `Accounting entry duplicated: ${sourceEntryId} -> ${newEntry.id}`, {
      action: 'DUPLICATE_ACCOUNTING_ENTRY',
      companyId,
      metadata: { sourceEntryId, newEntryId: newEntry.id },
    })

    return NextResponse.json(newEntry, { status: 201 })
  },
)
