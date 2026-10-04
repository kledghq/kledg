import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromQueryOrBody } from '@/lib/api/route'
import { setEntriesStatus } from '@/lib/accounting/services'
import { EntryIdsBody } from '@/lib/api/entry-input'
import { writeAuditLog } from '@/lib/audit'

const BulkStatusBody = EntryIdsBody.extend({
  status: z.enum(['draft', 'validated'], { error: 'Le statut doit être "draft" ou "validated"' }),
})

/**
 * Validates drafts ({ status: "validated" }): each one gets its definitive
 * number, in date order. Putting validated entries back to draft is refused
 * (PCG art. 1031-3): they can only be reversed.
 */
export const POST = companyRoute(
  { company: fromQueryOrBody(), permission: { entries: ['validate'] }, body: BulkStatusBody },
  async ({ companyId, body }) => {
    const { validated, errors } = await setEntriesStatus(companyId, body.entryIds, body.status)

    for (const entry of validated) {
      await writeAuditLog('info', `Accounting entry validated: ${entry.description || entry.reference || entry.id}`, {
        action: 'VALIDATE_ACCOUNTING_ENTRY',
        companyId,
        metadata: { entryId: entry.id, entryNumber: entry.entryNumber, status: entry.status },
      })
    }

    return NextResponse.json({
      success: true,
      validated: validated.length,
      failed: errors.length,
      results: validated,
      errors,
    })
  },
)
