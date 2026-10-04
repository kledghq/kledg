import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { deleteFixedAsset } from '@/lib/fixed-assets/delete-fixed-asset.service'
import { getFixedAsset } from '@/lib/fixed-assets/read-fixed-assets.service'
import { updateFixedAsset } from '@/lib/fixed-assets/update-fixed-asset.service'
import { UpdateFixedAssetSchema } from '@/lib/fixed-assets/schemas'

export const GET = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { entries: ['read'] } },
  async ({ params, companyId }) => NextResponse.json(await getFixedAsset(companyId, params.id as string)),
)

export const PATCH = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { ledger: ['manage'] }, body: UpdateFixedAssetSchema },
  async ({ params, companyId, body }) => NextResponse.json(await updateFixedAsset(companyId, params.id as string, body)),
)

/**
 * DELETE: removes a fixed asset and its depreciation records. Draft
 * depreciation entries linked to it are deleted with it. Booked (validated)
 * depreciation entries are definitive (PCG art. 1031-3): the deletion is
 * refused with the entries to reverse first, or the asset is to be taken out
 * of the books by a disposal (cession, mise au rebut) instead.
 */
export const DELETE = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { ledger: ['manage'] } },
  async ({ params, companyId }) => {
    const deletedEntries = await deleteFixedAsset(companyId, params.id as string)
    return NextResponse.json({ success: true, deletedEntries })
  },
)
