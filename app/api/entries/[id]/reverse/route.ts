import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfEntry } from '@/lib/api/resources'
import { reverseEntry } from '@/lib/accounting/services'
import { writeAuditLog } from '@/lib/audit'

/** Optional body: the day of the contre-passation (checked by the service). */
const ReverseEntryBody = z.object({ date: z.string({ error: 'Date attendue au format AAAA-MM-JJ' }).nullish() }).optional()

/**
 * Contre-passation of a validated entry: creates and validates the entry that
 * cancels it (debits and credits swapped), linked to it, and returns it (201).
 *
 * Body (optional): { date: "yyyy-mm-dd" }, a day of an open fiscal year; the
 * original entry date by default. 409 when the entry is a draft (edit or
 * delete it instead), already reversed, or the chosen year is closed.
 *
 * Also the follow-up of a refused reconciliation undo (409 on a validated
 * entry): the reconciliation dialog can call this route.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfEntry), permission: { entries: ['create', 'validate'] }, body: ReverseEntryBody },
  async ({ params, companyId, body }) => {
    const id = params.id as string
    const reversal = await reverseEntry(companyId, id, { date: body?.date || undefined })

    await writeAuditLog('info', `Accounting entry reversed: ${reversal.reversalOf?.entryNumber} -> ${reversal.entryNumber}`, {
      action: 'REVERSE_ACCOUNTING_ENTRY',
      companyId,
      metadata: {
        entryId: id,
        reversalEntryId: reversal.id,
        reversalEntryNumber: reversal.entryNumber,
        date: reversal.date,
      },
    })

    return NextResponse.json(reversal, { status: 201 })
  },
)
