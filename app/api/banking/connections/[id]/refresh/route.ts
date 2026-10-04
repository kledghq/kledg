import { companyRoute, fromResource, NextResponse } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { assertSameOrigin } from '@/lib/api/same-origin'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { resolveClientIp } from '@/lib/client-ip'
import { limitBankCalls } from '@/lib/banking/guard'
import { companyOfBankConnection, refreshConnection } from '@/lib/banking/connections.service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/banking/connections/[id]/refresh
 * "Actualiser" one bank connection while the user is on the page. For
 * Ponto it also asks the bank for fresh data with the user's IP (Ponto
 * terms), at most every 5 minutes (429 otherwise).
 */
export const POST = companyRoute(
  { company: fromResource(companyOfBankConnection), permission: { banking: ['reconcile'] } },
  async ({ request, params, companyId }) => {
    assertSameOrigin(request)
    await limitBankCalls(companyId)
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) throw new ValidationError("La clé de chiffrement de l'instance n'est pas configurée.")
    const result = await refreshConnection({
      connectionId: params.id as string,
      companyId,
      customerIp: resolveClientIp(request.headers) ?? 'unknown',
      encryptionKey,
    })
    return NextResponse.json(result)
  },
)
