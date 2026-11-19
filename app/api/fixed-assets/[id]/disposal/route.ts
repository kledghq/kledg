import { NextResponse } from 'next/server'
import { companyRoute, fromResource } from '@/lib/api/route'
import { companyOfFixedAsset } from '@/lib/api/resources'
import { cancelDisposal, recordDisposal, RecordDisposalSchema } from '@/lib/fixed-assets/record-disposal.service'

/**
 * POST: records the exit of the fixed asset (sale, scrap, destruction) and
 * prepares its exit entry as a draft in the OD journal, replacing an
 * earlier draft; with dryRun, only computes the gain or loss and the lines.
 * 409 once the exit entry is validated, or in a closed fiscal year.
 */
export const POST = companyRoute(
  // The asset changes and a draft entry is created
  { company: fromResource(companyOfFixedAsset), permission: { ledger: ['manage'], entries: ['create'] }, body: RecordDisposalSchema },
  async ({ params, companyId, body }) => NextResponse.json(await recordDisposal(companyId, params.id as string, body)),
)

/** DELETE: cancels the exit and deletes its draft entry; 409 once the entry is validated. */
export const DELETE = companyRoute(
  { company: fromResource(companyOfFixedAsset), permission: { ledger: ['manage'], entries: ['delete'] } },
  async ({ params, companyId }) => NextResponse.json(await cancelDisposal(companyId, params.id as string)),
)
