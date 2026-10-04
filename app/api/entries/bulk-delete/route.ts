import { NextResponse } from 'next/server'
import { companyRoute, fromQueryOrBody } from '@/lib/api/route'
import { deleteDraftEntries } from '@/lib/accounting/services'
import { EntryIdsBody } from '@/lib/api/entry-input'
import { writeAuditLog } from '@/lib/audit'

/** Deletes drafts. Validated entries are refused one by one (they can only be reversed). */
export const POST = companyRoute(
  { company: fromQueryOrBody(), permission: { entries: ['delete'] }, body: EntryIdsBody },
  async ({ companyId, body }) => {
    // Only entries of the company: ids of other companies are reported as not found
    const { deleted, errors } = await deleteDraftEntries(companyId, body.entryIds)

    for (const entry of deleted) {
      await writeAuditLog('info', `Accounting entry deleted: ${entry.description || entry.reference || entry.id}`, {
        action: 'DELETE_ACCOUNTING_ENTRY',
        companyId,
        metadata: { entryId: entry.id, description: entry.description, reference: entry.reference },
      })
    }

    return NextResponse.json({
      success: true,
      deleted: deleted.length,
      failed: errors.length,
      results: deleted.map((entry) => ({ entryId: entry.id, success: true })),
      errors,
    })
  },
)
