import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { listLinkCandidates } from '@/lib/fixed-assets/manage-depreciation-records.service'

/** GET: entries of the record's fiscal year it could be linked to, likely allowances first. */
export const GET = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['read'] } },
  async ({ params, companyId }) =>
    NextResponse.json(await listLinkCandidates(companyId, params.id as string, params.entryId as string)),
)
