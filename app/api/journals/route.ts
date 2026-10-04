import { NextResponse } from 'next/server'
import { z } from 'zod'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { createJournal } from '@/lib/accounting/create-journal.service'
import { listJournals } from '@/lib/accounting/manage-journals.service'

/** Code and label are checked by the service (normalized code, French messages). */
const CreateJournalBody = z.object({
  code: z.string({ error: 'Le code est requis' }),
  label: z.string({ error: 'Le libellé est requis' }),
})

export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: CreateJournalBody },
  // The body companyId may be a slug: the resolved id is used
  async ({ companyId, body }) => NextResponse.json(await createJournal(companyId, body), { status: 201 }),
)

/** Journals of the company (read only, lib/accounting/manage-journals.service.ts). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listJournals(companyId)),
)
