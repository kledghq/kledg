import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfJournal } from '@/lib/api/resources'
import { deleteJournal, updateJournal } from '@/lib/accounting/manage-journals.service'

const UpdateJournalBody = z.object({
  code: z.string({ error: 'Le code doit être un texte' }).optional(),
  label: z.string({ error: 'Le libellé doit être un texte' }).optional(),
})

export const PATCH = companyRoute(
  { company: fromResource(companyOfJournal), permission: { ledger: ['manage'] }, body: UpdateJournalBody },
  async ({ params, companyId, body }) => NextResponse.json(await updateJournal(companyId, params.id as string, body)),
)

/** Deletes a journal without entries (409 when entries are booked in it). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfJournal), permission: { ledger: ['manage'] } },
  async ({ params, companyId }) => {
    await deleteJournal(companyId, params.id as string)
    return NextResponse.json({ success: true })
  },
)
