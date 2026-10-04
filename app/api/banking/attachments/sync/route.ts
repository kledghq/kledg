import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { syncQontoAttachments } from '@/lib/integrations/providers/qonto/sync-attachments'
import { limitBankCalls } from '@/lib/banking/guard'

/**
 * POST /api/banking/attachments/sync
 * Copies the receipts Qonto holds for the company's Qonto debits
 * (lib/integrations/providers/qonto/sync-attachments.ts).
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] } },
  async ({ companyId }) => {
    await limitBankCalls(companyId)
    return NextResponse.json(await syncQontoAttachments(companyId))
  },
)
