import { z } from 'zod'
import { companyRoute, fromBody, fromQuery, NextResponse } from '@/lib/api/route'
import { ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { guardBankConnect } from '@/lib/banking/guard'
import { getRevolutSetup, setupRevolut } from '@/lib/banking/revolut-connection.service'
import { getRevolutRedirectUri, REVOLUT_API_PLANS } from '@/lib/banking/providers/revolut/config'

export const dynamic = 'force-dynamic'

/**
 * GET /api/banking/revolut?companyId=
 * Setup of the Revolut Business connection: public certificate, redirect
 * URI, client id and status. The private key is never returned.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { banking: ['manage'] } }, async ({ companyId }) => {
  const setup = await getRevolutSetup(companyId)
  return NextResponse.json({ setup, redirectUri: getRevolutRedirectUri(), plans: REVOLUT_API_PLANS })
})

const setupSchema = z.object({ companyId: z.string().min(1), regenerate: z.boolean().optional() })

/**
 * POST /api/banking/revolut { companyId, regenerate? }
 * Generates the key pair and the certificate to paste in Revolut Business.
 */
export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['manage'] }, body: setupSchema },
  async ({ request, companyId, user, body }) => {
    await guardBankConnect(request, companyId, user)
    const encryptionKey = getEncryptionKey()
    if (!encryptionKey) throw new ValidationError("La clé de chiffrement de l'instance n'est pas configurée.")
    const setup = await setupRevolut(companyId, encryptionKey, { regenerate: body.regenerate })
    await writeAuditLog('info', 'Revolut Business certificate generated', {
      action: 'BANK_REVOLUT_CERTIFICATE',
      companyId,
      metadata: { integrationId: setup.integrationId, regenerate: Boolean(body.regenerate) },
    })
    return NextResponse.json({ setup, redirectUri: setup.redirectUri, plans: REVOLUT_API_PLANS })
  },
)
