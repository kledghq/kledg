/**
 * Revolut Business connection, in three steps
 * (https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request):
 *
 * 1. setupRevolut: Kledg generates the RSA key and a self-signed X.509
 *    certificate. The user pastes the certificate in Revolut Business
 *    (Settings > APIs > Business API) with the OAuth redirect URI of this
 *    instance, and gets a client id. The private key never leaves the
 *    server and is stored encrypted.
 * 2. startRevolutAuthorization: with the client id, Kledg sends the user to
 *    the Revolut consent page with a one-time `state` bound to the company,
 *    the integration and the user (hash stored on the integration, value in
 *    an HttpOnly cookie on the user's browser).
 * 3. completeRevolutAuthorization: the callback checks the state against
 *    the cookie and the stored hash (same user, not expired, used once),
 *    exchanges the code with a client assertion and stores the refresh
 *    token encrypted. Access tokens are then refreshed on each sync.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ForbiddenError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { getEncryptionKey } from '@/lib/crypto/encryption-key'
import { logger } from '@/lib/logger'
import { mergeSealed, openCredentials } from '@/lib/banking/credentials'
import { errorReason } from '@/lib/banking/errors'
import { syncIntegration } from '@/lib/integrations/sync'
import { generateRevolutKeyMaterial } from '@/lib/banking/providers/revolut/certificate'
import { RevolutClient } from '@/lib/banking/providers/revolut/client'
import {
  getRevolutEnvironment,
  getRevolutRedirectUri,
  getRevolutUrls,
  type RevolutEnvironment,
} from '@/lib/banking/providers/revolut/config'
import { issuerFromRedirectUri } from '@/lib/banking/providers/revolut/jwt'
import { IntegrationFeature } from '@/lib/integrations/types'

/** Cookie holding the OAuth state on the user's browser during the consent. */
export const REVOLUT_STATE_COOKIE = 'kledg_revolut_oauth'
/** The consent must be completed within 10 minutes. */
export const REVOLUT_STATE_TTL_SECONDS = 600

const NAME = 'Revolut Business'

interface OAuthPending {
  stateHash: string
  userId: string
  expiresAt: string
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Integration id carried by a state value (`<integrationId>.<random>`). */
function integrationIdFromState(state: string | null | undefined): string | null {
  if (!state) return null
  const [id, nonce] = state.split('.')
  return id && nonce && /^[a-z0-9]{10,40}$/i.test(id) ? id : null
}

async function findRevolutIntegration(companyId: string) {
  return prisma.integration.findFirst({
    where: { companyId, provider: 'REVOLUT', type: 'BANKING' },
    orderBy: { createdAt: 'desc' },
  })
}

export interface RevolutSetup {
  integrationId: string
  certificate: string
  certificateExpiresAt: string | null
  redirectUri: string
  environment: RevolutEnvironment
  clientId: string | null
  status: string
}

function setupView(integration: { id: string; status: string; credentials: Prisma.JsonValue }): RevolutSetup {
  const c = (integration.credentials ?? {}) as Record<string, unknown>
  return {
    integrationId: integration.id,
    certificate: typeof c.certificate === 'string' ? c.certificate : '',
    certificateExpiresAt: typeof c.certificateExpiresAt === 'string' ? c.certificateExpiresAt : null,
    redirectUri: typeof c.redirectUri === 'string' ? c.redirectUri : getRevolutRedirectUri(),
    environment: c.environment === 'sandbox' ? 'sandbox' : 'production',
    clientId: typeof c.clientId === 'string' ? c.clientId : null,
    status: integration.status,
  }
}

/** Current setup of the company's Revolut connection (no secret), or null. */
export async function getRevolutSetup(companyId: string): Promise<RevolutSetup | null> {
  const integration = await findRevolutIntegration(companyId)
  return integration ? setupView(integration) : null
}

/**
 * Step 1: key pair and certificate. Reuses the existing certificate unless
 * `regenerate` (a new certificate means a new client id in Revolut).
 */
export async function setupRevolut(
  companyId: string,
  encryptionKey: string,
  options: { regenerate?: boolean; now?: Date } = {},
): Promise<RevolutSetup> {
  const existing = await findRevolutIntegration(companyId)
  if (existing && !options.regenerate && setupView(existing).certificate) return setupView(existing)

  const redirectUri = getRevolutRedirectUri()
  const material = generateRevolutKeyMaterial({ commonName: issuerFromRedirectUri(redirectUri), now: options.now })
  const plain = {
    privateKey: material.privateKeyPem,
    certificate: material.certificatePem,
    certificateExpiresAt: material.notAfter.toISOString(),
    redirectUri,
    environment: getRevolutEnvironment(),
    // A new certificate invalidates the previous client id and tokens
    clientId: null,
    refreshToken: null,
    authorizedAt: null,
  }
  if (existing) {
    const updated = await prisma.integration.update({
      where: { id: existing.id },
      data: {
        credentials: mergeSealed('REVOLUT', existing.credentials, plain, encryptionKey, companyId) as Prisma.InputJsonValue,
        credentialsEncrypted: true,
        status: 'pending',
        metadata: {},
      },
    })
    return setupView(updated)
  }
  const created = await prisma.integration.create({
    data: {
      companyId,
      provider: 'REVOLUT',
      type: 'BANKING',
      name: NAME,
      status: 'pending',
      credentials: mergeSealed('REVOLUT', {}, plain, encryptionKey, companyId) as Prisma.InputJsonValue,
      credentialsEncrypted: true,
      featureConfigs: {
        create: [
          { feature: IntegrationFeature.BANKING_ACCOUNTS, enabled: true },
          { feature: IntegrationFeature.BANKING_TRANSACTIONS, enabled: true },
        ],
      },
    },
  })
  return setupView(created)
}

/**
 * Step 2: saves the client id and returns the consent URL. The returned
 * `state` goes in the REVOLUT_STATE_COOKIE cookie.
 */
export async function startRevolutAuthorization(
  companyId: string,
  userId: string,
  clientId: string,
  now: Date = new Date(),
): Promise<{ url: string; state: string }> {
  const integration = await findRevolutIntegration(companyId)
  if (!integration || !setupView(integration).certificate) {
    throw new ValidationError("Générez d'abord le certificat Revolut.")
  }
  const setup = setupView(integration)
  const state = `${integration.id}.${randomBytes(32).toString('base64url')}`
  const pending: OAuthPending = {
    stateHash: sha256(state),
    userId,
    expiresAt: new Date(now.getTime() + REVOLUT_STATE_TTL_SECONDS * 1000).toISOString(),
  }
  const credentials = { ...((integration.credentials ?? {}) as Record<string, unknown>), clientId }
  await prisma.integration.update({
    where: { id: integration.id },
    data: { credentials: credentials as Prisma.InputJsonValue, metadata: { oauth: { ...pending } } },
  })

  const url = new URL(getRevolutUrls(setup.environment).consent)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', setup.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'READ')
  url.searchParams.set('state', state)
  return { url: url.toString(), state }
}

const INVALID_STATE = "Lien d'autorisation Revolut invalide ou expiré. Recommencez depuis Kledg."

/**
 * Step 3, run by the callback route for the company resolved from the
 * state. Throws 403 when the state does not match this user's pending
 * consent. Returns the integration id once the refresh token is stored.
 */
async function completeRevolutAuthorization(input: {
  companyId: string
  userId: string
  code: string
  /** `state` query parameter, when Revolut echoes it. */
  state: string | null
  /** State from the HttpOnly cookie set at step 2. */
  cookieState: string | null
  encryptionKey: string
  fetch?: typeof fetch
  now?: Date
}): Promise<string> {
  const now = input.now ?? new Date()
  // The browser must carry the cookie set when this user started the consent;
  // a state in the URL must be the same one.
  if (!input.cookieState || (input.state && input.state !== input.cookieState)) throw new ForbiddenError(INVALID_STATE)
  const state = input.cookieState
  const integrationId = integrationIdFromState(state)
  const integration = integrationId
    ? await prisma.integration.findFirst({ where: { id: integrationId, companyId: input.companyId, provider: 'REVOLUT' } })
    : null
  const pending = ((integration?.metadata ?? {}) as { oauth?: OAuthPending }).oauth
  if (
    !integration ||
    !pending ||
    !sameHash(pending.stateHash, sha256(state)) ||
    pending.userId !== input.userId ||
    new Date(pending.expiresAt) <= now
  ) {
    throw new ForbiddenError(INVALID_STATE)
  }

  // Used once: clear it before calling Revolut
  await prisma.integration.update({ where: { id: integration.id }, data: { metadata: {} } })

  const credentials = openCredentials('REVOLUT', integration.credentials, integration.credentialsEncrypted, input.encryptionKey, input.companyId)
  const setup = setupView(integration)
  if (!setup.clientId || typeof credentials.privateKey !== 'string') throw new ValidationError(INVALID_STATE)

  const client = new RevolutClient({
    apiUrl: getRevolutUrls(setup.environment).api,
    clientId: setup.clientId,
    issuer: issuerFromRedirectUri(setup.redirectUri),
    privateKeyPem: credentials.privateKey,
    fetch: input.fetch,
    now: () => now,
  })
  const tokens = await client.exchangeCode(input.code)
  if (!tokens.refresh_token) throw new ValidationError("Revolut n'a pas renvoyé de jeton de renouvellement.")

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      status: 'active',
      credentials: mergeSealed(
        'REVOLUT',
        integration.credentials,
        { refreshToken: tokens.refresh_token, authorizedAt: now.toISOString() },
        input.encryptionKey,
        input.companyId,
      ) as Prisma.InputJsonValue,
      credentialsEncrypted: true,
    },
  })
  return integration.id
}

/** Query of the OAuth callback: Revolut sends `code` (absent when the user declines) and may echo `state`. */
export const RevolutCallbackQuerySchema = z.object({
  code: z.string().max(512, "Code d'autorisation invalide.").optional(),
  state: z.string().max(1024).optional(),
})

/** Where the callback sends the browser back: the Revolut setup page with this status. */
export type RevolutConsentOutcome = 'connected' | 'error' | 'denied'

/**
 * Step 3 as the OAuth callback runs it: the browser must always land back on
 * the setup page, so a code Revolut refuses becomes the 'error' status
 * (the reason goes to the log only) instead of an error response. A state
 * that does not match this user's pending consent is still refused (403).
 * Once connected, the first sync runs; its failure is logged, the
 * connection stays.
 */
export async function finishRevolutConsent(input: {
  companyId: string
  userId: string
  code: string | undefined
  state: string | undefined
  cookieState: string | null
  fetch?: typeof fetch
}): Promise<RevolutConsentOutcome> {
  if (!input.code) return 'denied'
  const encryptionKey = getEncryptionKey()
  if (!encryptionKey) throw new ValidationError("La clé de chiffrement de l'instance n'est pas configurée.")

  let integrationId: string
  try {
    integrationId = await completeRevolutAuthorization({
      companyId: input.companyId,
      userId: input.userId,
      code: input.code,
      state: input.state ?? null,
      cookieState: input.cookieState,
      encryptionKey,
      fetch: input.fetch,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) throw error
    logger.warn('[Revolut] Authorization code exchange failed', { companyId: input.companyId, reason: errorReason(error) })
    return 'error'
  }

  await writeAuditLog('info', 'Revolut Business connected', {
    action: 'BANK_REVOLUT_CONNECT',
    companyId: input.companyId,
    metadata: { integrationId },
  })
  const sync = await syncIntegration(integrationId, encryptionKey, [
    IntegrationFeature.BANKING_ACCOUNTS,
    IntegrationFeature.BANKING_TRANSACTIONS,
  ])
  if (!sync.success) logger.warn('[Revolut] First sync failed', { companyId: input.companyId, errors: sync.errors.length })
  return 'connected'
}

/** Company of the integration named by a state value (resolver of the callback route). */
export async function companyOfRevolutState(state: string | null | undefined): Promise<{ companyId: string } | null> {
  const id = integrationIdFromState(state)
  if (!id) return null
  return prisma.integration.findFirst({ where: { id, provider: 'REVOLUT' }, select: { companyId: true } })
}
