import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfTransaction } from '@/lib/api/resources'
import { byPresenceOf } from '@/lib/api/zod-fields'
import { getReconciliationContext } from '@/lib/reconciliation/context'
import {
  reconcileWithEntrySchema,
  reconcileWithExistingEntry,
  reconcileWithNewEntry,
  unreconcileTransaction,
} from '@/lib/reconciliation/service'

/** With `lines`: a new entry; else an existing entry (`entryId`) or none. */
const ReconcileBodySchema = byPresenceOf(
  'lines',
  reconcileWithEntrySchema,
  z.object({ entryId: z.string({ error: 'entryId invalide' }).nullable().optional() }),
)

/**
 * GET /api/transactions/[id]/reconcile
 * What the "Traiter la transaction" dialog needs: amounts in cents, the locked
 * bank line, fiscal years, and the suggested counterpart lines.
 */
export const GET = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getReconciliationContext(companyId, params.id as string)),
)

/**
 * POST /api/transactions/[id]/reconcile
 * - `{ journalId, date, lines, description?, reference? }`: creates the entry
 *   (locked bank line + counterpart lines, amounts as decimal strings) and
 *   reconciles the transaction, in one database transaction. 201.
 * - `{ entryId }`: reconciles with an existing entry of the company.
 * - `{}` (or no body): marks the transaction reconciled without an entry.
 * 409 when the transaction is already reconciled (double submit included),
 * 400 when the entry is invalid, 404 for ids of another company.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['reconcile'] }, body: ReconcileBodySchema },
  async ({ params, companyId, body }) => {
    const id = params.id as string
    if ('lines' in body) {
      const entry = await reconcileWithNewEntry(companyId, id, body)
      return NextResponse.json({ transactionId: id, entryId: entry.id, entryNumber: entry.entryNumber, status: entry.status }, { status: 201 })
    }
    const transaction = await reconcileWithExistingEntry(companyId, id, body.entryId || null)
    return NextResponse.json({ ...transaction, reconciledAt: transaction.reconciledAt?.toISOString() ?? null })
  },
)

/**
 * DELETE /api/transactions/[id]/reconcile
 * Undoes the reconciliation atomically: deletes the draft entry it created
 * (409 when that entry is validated or in a closed year), keeps an entry that
 * was only linked. 409 when the transaction is not reconciled.
 */
export const DELETE = companyRoute(
  { company: fromResource(companyOfTransaction), permission: { banking: ['reconcile'] } },
  async ({ params, companyId }) => NextResponse.json(await unreconcileTransaction(companyId, params.id as string)),
)
