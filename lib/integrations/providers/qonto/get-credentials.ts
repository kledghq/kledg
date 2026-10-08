/**
 * Qonto API key of a company, decrypted: from the legacy BankConnection
 * columns first, else from the Qonto integration. Failures are typed errors
 * with French messages (404 when Qonto is not connected); the decryption
 * detail only goes to the log.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { decrypt } from '@/lib/integrations/encryption'
import { logger } from '@/lib/logger'
import { requireEncryptionKey } from '@/lib/banking/credentials'
import { QontoClient } from './client'

export interface QontoCredentials {
  login: string
  secretKey: string
}

export const QONTO_NOT_CONNECTED_MESSAGE = "Qonto n'est pas connecté pour cette société : connectez-le depuis la page Banque."
const UNREADABLE_MESSAGE =
  'La clé API Qonto enregistrée ne peut plus être lue : saisissez-la de nouveau depuis la page Banque.'

export async function getQontoCredentials(companyId: string): Promise<QontoCredentials> {
  const encryptionKey = requireEncryptionKey()

  const connection = await prisma.bankConnection.findUnique({
    where: { companyId_provider: { companyId, provider: 'QONTO' } },
    select: { login: true, secretKeyEncrypted: true },
  })
  if (connection?.secretKeyEncrypted) {
    try {
      return { login: connection.login, secretKey: decrypt(connection.secretKeyEncrypted, encryptionKey) }
    } catch (error) {
      logger.warn('[Qonto] Legacy connection key unreadable, trying the integration', error)
    }
  }

  const integration = await prisma.integration.findFirst({
    where: { companyId, provider: 'QONTO', status: 'active', type: 'BANKING' },
    select: { credentials: true, credentialsEncrypted: true },
  })
  if (!integration) throw new NotFoundError(QONTO_NOT_CONNECTED_MESSAGE)

  const stored = (integration.credentials ?? {}) as { login?: unknown; secretKey?: unknown }
  const login = typeof stored.login === 'string' ? stored.login : ''
  let secretKey = typeof stored.secretKey === 'string' ? stored.secretKey : ''
  if (integration.credentialsEncrypted && secretKey) {
    try {
      secretKey = decrypt(secretKey, encryptionKey)
    } catch (error) {
      logger.error('[Qonto] Integration key unreadable', error)
      throw new ValidationError(UNREADABLE_MESSAGE)
    }
  }
  if (!login || !secretKey) throw new ValidationError(UNREADABLE_MESSAGE)
  return { login, secretKey }
}

/** A Qonto client with the company's stored API key. */
export async function qontoClientFor(companyId: string): Promise<QontoClient> {
  const { login, secretKey } = await getQontoCredentials(companyId)
  return new QontoClient(login, secretKey)
}
