/**
 * Annexe des comptes annuels (docs/annexe-et-2054.md): GET reads the notes
 * required by the company's size category with what is still missing, PUT
 * saves what the user answered (commitments, events after the closing...).
 * Rules in lib/annexe.
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getAnnexe } from '@/lib/annexe/get-annexe.service'
import { saveAnnexeNotes } from '@/lib/annexe/save-annexe-notes.service'
import { AnnexeBodySchema, AnnexeQuerySchema } from '@/lib/annexe/schemas'
import { userGroupAccess } from '@/lib/management-fees/access'

/** GET /api/annexe?companyId=&fiscalYearId=: the notes, the list of PCG articles applied and what is missing. */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] }, query: AnnexeQuerySchema }, async ({ companyId, user, query }) =>
  NextResponse.json(await getAnnexe(companyId, query.fiscalYearId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS }),
)

/** PUT /api/annexe { companyId, fiscalYearId, details }: the whole answers object; answers the updated annexe. */
export const PUT = companyRoute({ company: fromBody(), permission: { closing: ['execute'] }, body: AnnexeBodySchema }, async ({ companyId, user, body }) => {
  await saveAnnexeNotes(companyId, body.fiscalYearId, body.details, user.id)
  return NextResponse.json(await getAnnexe(companyId, body.fiscalYearId, userGroupAccess(user)), { headers: NO_CACHE_HEADERS })
})
