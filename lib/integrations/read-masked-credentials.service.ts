/**
 * Credentials of an integration for its edit form: the login and a masked
 * hint of the secret. Invariant: the secret itself is never returned
 * (editing means typing a new one).
 */

import { prisma } from '@/lib/prisma'
import { findOwned } from '@/lib/api/resources'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { decrypt, integrationContext } from '@/lib/integrations/encryption'
import { logger } from '@/lib/logger'

export interface MaskedCredentials {
  provider: string
  type: string
  credentials: { login: string | null; secretKeyMasked: string | null; hasSecretKey: boolean }
}

/** "••••" followed by the last 4 characters of a long secret (nothing more). */
export function maskSecret(secret: string | undefined): string | null {
  if (!secret) return null
  return `••••${secret.length > 8 ? secret.slice(-4) : ''}`
}

/** The stored secret in clear, or undefined when there is none or it can no longer be read. */
function readSecret(stored: unknown, encrypted: boolean, integrationId: string, context: string): string | undefined {
  if (typeof stored !== 'string' || !stored) return undefined
  if (!encrypted) return stored
  const encryptionKey = getEncryptionKey()
  if (!encryptionKey) return undefined
  try {
    return decrypt(stored, encryptionKey, context)
  } catch (error) {
    // Sealed with another instance key: the form shows no hint and the user types a new secret
    logger.warn('[Integrations] Stored secret unreadable', { integrationId, error })
    return undefined
  }
}

export async function readMaskedCredentials(companyId: string, integrationId: string): Promise<MaskedCredentials> {
  const integration = await findOwned(
    prisma.integration.findFirst({
      where: { id: integrationId, companyId },
      select: { provider: true, type: true, credentials: true, credentialsEncrypted: true },
    }),
    'Connexion bancaire introuvable',
  )

  // Qonto: login + secretKey; Ponto: clientId + clientSecret
  const stored = (integration.credentials ?? {}) as Record<string, unknown>
  const ponto = integration.provider === 'PONTO'
  const loginValue = ponto ? stored.clientId : stored.login
  const secretField = ponto ? 'clientSecret' : 'secretKey'
  const secret = readSecret(
    stored[secretField],
    integration.credentialsEncrypted,
    integrationId,
    integrationContext(companyId, integration.provider, secretField),
  )

  return {
    provider: integration.provider,
    type: integration.type,
    credentials: {
      login: typeof loginValue === 'string' ? loginValue : null,
      secretKeyMasked: maskSecret(secret),
      hasSecretKey: Boolean(secret),
    },
  }
}
