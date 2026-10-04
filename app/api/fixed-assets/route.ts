import { NextResponse } from 'next/server'
import { companyRoute, fromBody, fromQuery } from '@/lib/api/route'
import { createFixedAsset } from '@/lib/fixed-assets/create-fixed-asset.service'
import { listFixedAssets } from '@/lib/fixed-assets/read-fixed-assets.service'
import { CreateFixedAssetSchema } from '@/lib/fixed-assets/schemas'

export const GET = companyRoute(
  { company: fromQuery(), permission: { entries: ['read'] } },
  async ({ companyId }) => NextResponse.json(await listFixedAssets(companyId)),
)

export const POST = companyRoute(
  { company: fromBody(), permission: { ledger: ['manage'] }, body: CreateFixedAssetSchema },
  async ({ companyId, body }) => {
    const { fixedAsset, warnings } = await createFixedAsset(companyId, body)
    // The asset with its PCG warnings (if any)
    return NextResponse.json({ ...fixedAsset, pcgWarnings: warnings }, { status: 201 })
  },
)
