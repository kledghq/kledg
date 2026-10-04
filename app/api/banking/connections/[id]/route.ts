import { companyRoute, fromResource, NextResponse } from '@/lib/api/route'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { writeAuditLog } from '@/lib/audit'
import { companyOfBankConnection, disconnectConnection } from '@/lib/banking/connections.service'

/**
 * DELETE /api/banking/connections/[id]
 * Disconnects a bank: its credentials are deleted, its accounts and
 * transactions stay (no longer synced).
 */
export const DELETE = companyRoute(
  { company: fromResource(companyOfBankConnection), permission: { banking: ['manage'] } },
  async ({ request, params, companyId }) => {
    assertSameOrigin(request)
    const id = params.id as string
    await disconnectConnection(id, companyId)
    await writeAuditLog('info', 'Bank connection disconnected', {
      action: 'BANK_DISCONNECT',
      companyId,
      metadata: { connectionId: id },
    })
    return new NextResponse(null, { status: 204 })
  },
)
