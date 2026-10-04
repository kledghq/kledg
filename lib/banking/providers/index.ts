/**
 * Builds the adapter of an integration from its decrypted credentials.
 */

import { ValidationError } from '@/lib/accounting/errors'
import { PontoProvider } from './ponto/provider'
import { QontoProvider } from './qonto'
import { getRevolutUrls, type RevolutEnvironment } from './revolut/config'
import { issuerFromRedirectUri } from './revolut/jwt'
import { RevolutProvider } from './revolut/provider'
import type { BankProvider, BankProviderId } from './types'

export type { BankProvider, BankProviderId } from './types'

export const BANK_PROVIDERS: readonly BankProviderId[] = ['QONTO', 'REVOLUT', 'PONTO']

export function isBankProvider(value: unknown): value is BankProviderId {
  return typeof value === 'string' && (BANK_PROVIDERS as readonly string[]).includes(value)
}

/** Direct connectors win over the aggregator for the same IBAN. */
export function providerKind(provider: string): 'direct' | 'aggregator' | 'manual' {
  if (provider === 'PONTO') return 'aggregator'
  if (provider === 'MANUAL') return 'manual'
  return 'direct'
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function createBankProvider(
  provider: string,
  credentials: Record<string, unknown>,
  options: { fetch?: typeof fetch } = {},
): BankProvider {
  switch (provider) {
    case 'QONTO':
      return new QontoProvider({ login: str(credentials.login), secretKey: str(credentials.secretKey) })
    case 'PONTO':
      return new PontoProvider({
        clientId: str(credentials.clientId),
        clientSecret: str(credentials.clientSecret),
        fetch: options.fetch,
      })
    case 'REVOLUT': {
      const redirectUri = str(credentials.redirectUri)
      if (!str(credentials.clientId) || !str(credentials.privateKey) || !redirectUri) {
        throw new ValidationError("La connexion Revolut n'est pas terminée.")
      }
      const environment = (credentials.environment === 'sandbox' ? 'sandbox' : 'production') as RevolutEnvironment
      const authorizedAt = str(credentials.authorizedAt)
      return new RevolutProvider({
        apiUrl: getRevolutUrls(environment).api,
        clientId: str(credentials.clientId),
        issuer: issuerFromRedirectUri(redirectUri),
        privateKeyPem: str(credentials.privateKey),
        refreshToken: str(credentials.refreshToken) || undefined,
        authorizedAt: authorizedAt ? new Date(authorizedAt) : null,
        fetch: options.fetch,
      })
    }
    default:
      throw new ValidationError(`Fournisseur bancaire non pris en charge : ${provider}`)
  }
}
