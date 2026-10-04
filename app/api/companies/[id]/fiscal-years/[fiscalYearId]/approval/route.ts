/**
 * Approval of a fiscal year's accounts (docs/approbation-des-comptes.md):
 * GET reads the pack (legal regime, allocation, resolutions, deadlines,
 * documents and what each misses, filing checklist), PUT saves what the
 * user entered. Rules in lib/approval.
 */

import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getApproval } from '@/lib/approval/get-approval.service'
import { saveApproval } from '@/lib/approval/save-approval.service'
import { ApprovalDetailsSchema } from '@/lib/approval/schemas'

export const GET = companyRoute(
  { company: fromParam('id'), permission: { reports: ['read'] } },
  async ({ params, companyId }) =>
    NextResponse.json(await getApproval(companyId, params.fiscalYearId as string), { headers: NO_CACHE_HEADERS }),
)

/** PUT: the whole details object (ApprovalDetailsSchema); answers the updated pack. */
export const PUT = companyRoute(
  { company: fromParam('id'), permission: { closing: ['execute'] }, body: ApprovalDetailsSchema },
  async ({ params, companyId, user, body }) => {
    await saveApproval(companyId, params.fiscalYearId as string, body, user.id)
    return NextResponse.json(await getApproval(companyId, params.fiscalYearId as string), { headers: NO_CACHE_HEADERS })
  },
)
