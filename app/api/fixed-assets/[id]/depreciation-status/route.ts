import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { getDepreciationStatus } from '@/lib/fixed-assets/get-depreciation-status.service'

/**
 * GET /api/fixed-assets/[id]/depreciation-status
 *
 * Depreciation recorded per fiscal year and per month (records, not
 * accounting entries) with the suggestions of the theoretical plan.
 */
export const GET = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getDepreciationStatus(companyId, params.id as string)),
)
