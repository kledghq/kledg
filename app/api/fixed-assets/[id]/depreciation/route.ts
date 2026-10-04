import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { saveDepreciationRecord } from '@/lib/fixed-assets/manage-depreciation-records.service'
import { SaveDepreciationRecordSchema } from '@/lib/fixed-assets/schemas'

/**
 * POST /api/fixed-assets/[id]/depreciation
 * body: { fiscalYearId, periodType: 'month' | 'year', monthIndex?, amount?, note? }
 *
 * Records (or replaces) the depreciation of one period: a record, not an
 * accounting entry. Without amount, the plan's amount for the period.
 */
export const POST = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['create'] }, body: SaveDepreciationRecordSchema },
  async ({ params, companyId, body, authorize }) => {
    const record = await saveDepreciationRecord(companyId, params.id as string, body, {
      // Replacing an existing record is an update
      authorizeReplace: () => authorize({ entries: ['update'] }),
    })
    return NextResponse.json(record, { status: 201 })
  },
)
