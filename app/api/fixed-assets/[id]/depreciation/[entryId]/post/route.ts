import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { postDepreciationRecord } from '@/lib/fixed-assets/manage-depreciation-records.service'

/**
 * POST: books the depreciation record as a validated OD entry (68 debit,
 * 28 credit) and links it. 409 when already booked or the year is closed.
 */
export const POST = companyRoute(
  // The generated entry is created validated
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['create', 'validate'] } },
  async ({ params, companyId }) =>
    NextResponse.json(await postDepreciationRecord(companyId, params.id as string, params.entryId as string)),
)
