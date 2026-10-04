import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { createEntry } from '@/lib/accounting/services'
import { CreateEntryBody, entryLines } from '@/lib/api/entry-input'
import { writeAuditLog } from '@/lib/audit'
import { listEntries, ListEntriesQuerySchema } from '@/lib/accounting/services/list-entries.service'

/**
 * Entries of the company (of one fiscal year with ?fiscalYearId=), newest
 * first, as an array. ?limit=N returns one page; the X-Next-Cursor header
 * then holds the value to pass as ?cursor= for the next page (absent on the
 * last page).
 *
 * Filters (ListEntriesQuerySchema): journalId, status (draft | validated |
 * all), number (part of the entry number), search (description, reference,
 * line labels), startDate and endDate (calendar days, included), minAmount
 * and maxAmount (euros, the larger of the debit and credit totals).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] }, query: ListEntriesQuerySchema },
  async ({ companyId, query }) => {
    const { entries, nextCursor } = await listEntries({ companyId, ...query })
    return NextResponse.json(entries, nextCursor ? { headers: { 'X-Next-Cursor': nextCursor } } : undefined)
  },
)

export const POST = companyRoute(
  { company: fromBody(), permission: { entries: ['create'] }, body: CreateEntryBody },
  async ({ companyId, body, authorize }) => {
    const { journalId, date, description, reference, pieceDate, fiscalYearId } = body
    const status = body.status || 'draft'
    if (status === 'validated') authorize({ entries: ['validate'] })

    // The service checks that the journal, accounts and fiscal year belong to
    // the company, that the year is open and that the entry balances.
    const entry = await createEntry({
      companyId,
      journalId,
      date,
      description,
      reference,
      pieceDate,
      status,
      fiscalYearId: fiscalYearId ?? undefined,
      lines: entryLines(body.lines),
    })

    await writeAuditLog('info', `Accounting entry created: ${description || reference || entry.id}`, {
      action: entry.status === 'validated' ? 'VALIDATE_ACCOUNTING_ENTRY' : 'CREATE_ACCOUNTING_ENTRY',
      companyId,
      metadata: {
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        journalId,
        date,
        description,
        reference,
        status: entry.status,
        linesCount: entry.lines.length,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  },
)
