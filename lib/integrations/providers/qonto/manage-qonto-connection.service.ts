/**
 * The direct Qonto connection of a company (API login and secret key): its
 * status, connecting it, and checking credentials.
 *
 * Invariants: the secret key is stored encrypted and never returned; Qonto's
 * own error messages never reach the user. A credential check answers
 * `{ valid: false, error }` with a French reason (errorReason,
 * lib/banking/errors.ts) instead of throwing: that answer is the contract of
 * the check, and the provider's detail goes to the log.
 */

import { z } from 'zod'
import { IntegrationProvider } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { BankAuthorizationError, errorReason, QONTO_CREDENTIALS_REFUSED } from '@/lib/banking/errors'
import { requireEncryptionKey } from '@/lib/banking/credentials'
import { bankConnectionContext, encrypt } from '@/lib/integrations/encryption'
import { QontoClient } from './client'
import { qontoClientFor } from './get-credentials'

/** Whether the company has an active Qonto connection, and its selected account. */
export async function getQontoStatus(companyId: string) {
  const connection = await prisma.bankConnection.findUnique({
    where: { companyId_provider: { companyId, provider: 'QONTO' } },
    select: {
      provider: true,
      status: true,
      lastSyncAt: true,
      selectedAccountId: true,
      _count: { select: { bankAccounts: true } },
      selectedAccount: { select: { id: true, iban: true, name: true } },
    },
  })
  return {
    connected: !!connection && connection.status === 'active',
    provider: connection?.provider,
    lastSyncAt: connection?.lastSyncAt,
    accountsCount: connection?._count.bankAccounts || 0,
    selectedAccountId: connection?.selectedAccountId,
    selectedAccount: connection?.selectedAccount ?? null,
  }
}

const CREDENTIALS_REQUIRED = "Saisissez l'identifiant et la clé secrète de l'organisation Qonto."

/** Body of POST /api/qonto/connect. */
export const ConnectQontoSchema = z.object({
  companyId: z.string().optional(),
  login: z.string({ error: CREDENTIALS_REQUIRED }).trim().min(1, CREDENTIALS_REQUIRED).max(200),
  secretKey: z.string({ error: CREDENTIALS_REQUIRED }).trim().min(1, CREDENTIALS_REQUIRED).max(500),
  /** IBAN of the account to select; empty or null: none. */
  selectedAccountId: z.string().max(100).nullish(),
})

/** Bank connection fields safe to return (no login, no secret). */
const CONNECTION_SELECT = {
  id: true,
  companyId: true,
  provider: true,
  selectedAccountId: true,
  lastSyncAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

/**
 * Connects Qonto with the credentials typed by the user: they are checked
 * against Qonto first, then stored encrypted on the company's Qonto
 * connection (created or replaced).
 */
export async function connectQonto(companyId: string, input: z.infer<typeof ConnectQontoSchema>) {
  const accounts = await new QontoClient(input.login, input.secretKey).getAccounts().catch((error: unknown) => {
    throw error instanceof BankAuthorizationError ? new ValidationError(QONTO_CREDENTIALS_REFUSED) : error
  })
  const selectedAccountId = input.selectedAccountId || null
  if (selectedAccountId && !accounts.some((account) => account.iban === selectedAccountId)) {
    throw new ValidationError("Le compte choisi n'existe pas dans cette organisation Qonto.")
  }

  const secretKeyEncrypted = encrypt(input.secretKey, requireEncryptionKey(), bankConnectionContext(companyId, 'QONTO'))
  const fields = {
    provider: IntegrationProvider.QONTO,
    login: input.login,
    secretKeyEncrypted,
    selectedAccountId,
    status: 'active',
  }
  return prisma.bankConnection.upsert({
    where: { companyId_provider: { companyId, provider: 'QONTO' } },
    update: fields,
    create: { companyId, ...fields },
    select: CONNECTION_SELECT,
  })
}

export type QontoCheck = { valid: true; organization: { bankAccountsCount: number } } | { valid: false; error: string }

/** Asks Qonto for the organization (GET /v2/organization); a refusal is `{ valid: false }` with a French reason. */
async function checkOrganization(client: QontoClient): Promise<QontoCheck> {
  try {
    const response = await client.getOrganization()
    return { valid: true, organization: { bankAccountsCount: response.organization?.bank_accounts?.length || 0 } }
  } catch (error) {
    return { valid: false, error: errorReason(error) }
  }
}

/** Checks the stored credentials of the company's Qonto connection (404 when Qonto is not connected). */
export async function testQontoConnection(companyId: string): Promise<QontoCheck> {
  return checkOrganization(await qontoClientFor(companyId))
}

/** Body of POST /api/qonto/verify: credentials are only read from the JSON body, never from the query string. */
export const VerifyQontoSchema = z.object({
  companyId: z.string().optional(),
  login: z.string().trim().min(1, "Saisissez l'identifiant de l'organisation Qonto.").max(200),
  secretKey: z.string().trim().min(1, 'Saisissez la clé secrète.').max(500),
})

/** Checks credentials typed by the user, without storing them. */
export function verifyQontoCredentials(input: z.infer<typeof VerifyQontoSchema>): Promise<QontoCheck> {
  return checkOrganization(new QontoClient(input.login, input.secretKey))
}
