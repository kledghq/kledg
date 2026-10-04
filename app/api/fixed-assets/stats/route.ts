import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { getFixedAssetStats } from '@/lib/fixed-assets/read-fixed-assets.service'

/** Totals of the Immobilisations page: acquisition value, depreciation of the current and earlier fiscal years. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getFixedAssetStats(companyId)),
)
