import { z } from 'zod'
import { companyRoute, fromBody, NextResponse } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { guardBankConnect } from '@/lib/banking/guard'
import { connectPonto } from '@/lib/banking/ponto-connection.service'

export const dynamic = 'force-dynamic'

const connectSchema = z.object({
  companyId: z.string().min(1),
  clientId: z.string().trim().min(1, "Collez l'identifiant client (client ID) de l'intégration Ponto.").max(200),
  clientSecret: z.string().trim().min(1, "Collez le secret client (client secret) de l'intégration Ponto.").max(500),
})

/**
 * POST /api/banking/ponto { companyId, clientId, clientSecret }
 * Connects the company's Ponto custom integration: credentials checked,
 * stored encrypted (never returned), accounts and transactions synced.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: connectSchema },
  async ({ request, companyId, user, body }) => {
    await guardBankConnect(request, companyId, user)
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) throw new ValidationError("La clé de chiffrement de l'instance n'est pas configurée.")
    const result = await connectPonto(companyId, { clientId: body.clientId, clientSecret: body.clientSecret }, encryptionKey)
    await writeAuditLog('info', 'Ponto connected', {
      action: 'BANK_PONTO_CONNECT',
      companyId,
      metadata: { integrationId: result.integrationId, accounts: result.accountsCount },
    })
    return NextResponse.json(
      { integrationId: result.integrationId, accountsCount: result.accountsCount, syncErrors: result.syncErrors.length },
      { status: 201 },
    )
  },
)
