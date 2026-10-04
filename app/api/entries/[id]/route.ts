import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfEntry } from '@/lib/api/resources'
import { deleteDraftEntry, getCompanyEntry, getEntryStatus, updateAccountingEntry } from '@/lib/accounting/services'
import { entryLines, UpdateEntryBody } from '@/lib/api/entry-input'
import { writeAuditLog } from '@/lib/audit'

export const GET = companyRoute(
  { company: fromResource(companyOfEntry), permission: { entries: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getCompanyEntry(companyId, params.id as string)),
)

/**
 * Edits a draft, or validates it ({ status: "validated" }). A validated entry
 * is refused with 409 (PCG art. 1031-3): it can only be reversed through
 * POST /api/entries/[id]/reverse.
 */
export const PATCH = companyRoute(
  { company: fromResource(companyOfEntry), permission: { entries: ['update'] }, body: UpdateEntryBody },
  async ({ params, companyId, body, authorize }) => {
    const id = params.id as string
    const { journalId, date, description, reference, pieceDate, lines, status } = body
    const previousStatus = await getEntryStatus(companyId, id)
    // Validating an entry is a separate permission
    if (status !== undefined && status !== previousStatus) authorize({ entries: ['validate'] })

    // The service refuses validated entries and checks journal, accounts and fiscal year
    const entry = await updateAccountingEntry(
      id,
      {
        ...(journalId && { journalId }),
        ...(date && { date }),
        ...(description !== undefined && { description }),
        ...(reference !== undefined && { reference }),
        ...(pieceDate !== undefined && { pieceDate }),
        ...(status !== undefined && { status }),
        ...(lines && { lines: entryLines(lines) }),
      },
      companyId,
    )

    const validated = previousStatus !== 'validated' && entry.status === 'validated'
    await writeAuditLog('info', `Accounting entry ${validated ? 'validated' : 'updated'}: ${entry.description || entry.reference || entry.id}`, {
      action: validated ? 'VALIDATE_ACCOUNTING_ENTRY' : 'UPDATE_ACCOUNTING_ENTRY',
      companyId,
      metadata: {
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        journalId: entry.journalId,
        status: entry.status,
        linesCount: lines?.length,
      },
    })

    return NextResponse.json(entry)
  },
)

/** Deletes a draft. A validated entry is refused with 409: reverse it instead. */
export const DELETE = companyRoute(
  { company: fromResource(companyOfEntry), permission: { entries: ['delete'] } },
  async ({ params, companyId }) => {
    const entry = await deleteDraftEntry(companyId, params.id as string)

    await writeAuditLog('info', `Accounting entry deleted: ${entry.description || entry.reference || entry.id}`, {
      action: 'DELETE_ACCOUNTING_ENTRY',
      companyId,
      metadata: { entryId: entry.id, description: entry.description, reference: entry.reference },
    })

    return NextResponse.json({ success: true })
  },
)
