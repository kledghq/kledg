import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { deleteDepreciationRecord, linkDepreciationRecord } from '@/lib/fixed-assets/manage-depreciation-records.service'
import { LinkDepreciationEntrySchema } from '@/lib/fixed-assets/schemas'

/** DELETE: removes a depreciation record (a record, not an accounting entry). */
export const DELETE = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['delete'] } },
  async ({ params, companyId }) => {
    await deleteDepreciationRecord(companyId, params.id as string, params.entryId as string)
    return NextResponse.json({ success: true })
  },
)

/**
 * PATCH body: { accountingEntryId: string | null }
 * Links (or unlinks with null) the record to an entry of its fiscal year.
 */
export const PATCH = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['update'] }, body: LinkDepreciationEntrySchema },
  async ({ params, companyId, body }) =>
    NextResponse.json(
      await linkDepreciationRecord(companyId, params.id as string, params.entryId as string, body.accountingEntryId ?? null),
    ),
)
