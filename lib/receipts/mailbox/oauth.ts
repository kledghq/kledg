/**
 * Sign-in to a receipt mailbox with Google or Microsoft (OAuth 2.0
 * authorization code with PKCE, RFC 7636), for the mailboxes where a
 * password is not accepted, or not wanted. Kledg then signs in to IMAP with
 * the access token (SASL XOAUTH2) and renews it with the refresh token.
 *
 * Each provider is offered when the instance holds its OAuth client, from
 * the environment (docs/configuration.md); hidden otherwise:
 * - Google: GOOGLE_MAIL_CLIENT_ID and GOOGLE_MAIL_CLIENT_SECRET, scope
 *   https://mail.google.com/, the one Gmail accepts for IMAP
 *   (https://developers.google.com/workspace/gmail/imap/xoauth2-protocol);
 * - Microsoft 365 and Outlook.com: MICROSOFT_MAIL_CLIENT_ID and
 *   MICROSOFT_MAIL_CLIENT_SECRET, optional MICROSOFT_MAIL_TENANT (default
 *   "common"), scope https://outlook.office.com/IMAP.AccessAsUser.All with
 *   offline_access for the refresh token
 *   (https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth).
 * The redirect URI to register at the provider is
 * <app URL>/api/receipts/mailbox/oauth/callback.
 *
 * The state needs no storage: it carries the company, the provider, the user
 * and an expiry, signed with the instance key, and goes both in the URL and
 * in an HttpOnly cookie of the browser that started (the callback requires
 * the two to match, and the same user). The PKCE verifier is derived from
 * the state with the same key, so it never leaves the server.
 */

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { getAppUrl } from '@/lib/config'

export type MailboxOAuthProvider = 'google' | 'microsoft'

export const MAILBOX_OAUTH_PROVIDERS: readonly MailboxOAuthProvider[] = ['google', 'microsoft']

/** Cookie holding the state on the user's browser during the consent. */
export const MAILBOX_OAUTH_COOKIE = 'kledg_mailbox_oauth'
export const MAILBOX_OAUTH_CALLBACK_PATH = '/api/receipts/mailbox/oauth/callback'
/** The consent must be completed within 10 minutes. */
export const MAILBOX_OAUTH_TTL_SECONDS = 600

export interface MailboxOAuthClient {
  provider: MailboxOAuthProvider
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  /** The IMAP server of the provider (port 993). */
  imapHost: string
  /** Extra parameters of the consent URL. */
  consentParams: Record<string, string>
}

type Env = Record<string, string | undefined>

const env = (name: string, source: Env): string | null => source[name]?.trim() || null

/** The OAuth client of a provider, or null when the instance does not offer it. */
export function mailboxOAuthClient(provider: MailboxOAuthProvider, source: Env = process.env): MailboxOAuthClient | null {
  if (provider === 'google') {
    const clientId = env('GOOGLE_MAIL_CLIENT_ID', source)
    const clientSecret = env('GOOGLE_MAIL_CLIENT_SECRET', source)
    if (!clientId || !clientSecret) return null
    return {
      provider,
      clientId,
      clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email https://mail.google.com/',
      imapHost: 'imap.gmail.com',
      // A refresh token each time: one is only sent with a consent (https://developers.google.com/identity/protocols/oauth2/web-server)
      consentParams: { access_type: 'offline', prompt: 'consent' },
    }
  }
  const clientId = env('MICROSOFT_MAIL_CLIENT_ID', source)
  const clientSecret = env('MICROSOFT_MAIL_CLIENT_SECRET', source)
  if (!clientId || !clientSecret) return null
  const tenant = env('MICROSOFT_MAIL_TENANT', source) ?? 'common'
  if (!/^[A-Za-z0-9.-]{1,100}$/.test(tenant)) return null
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`
  return {
    provider,
    clientId,
    clientSecret,
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
    scope: 'openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
    imapHost: 'outlook.office365.com',
    consentParams: { prompt: 'select_account' },
  }
}

/** The providers this instance offers, for the mailbox card. */
export function availableMailboxOAuthProviders(source: Env = process.env): MailboxOAuthProvider[] {
  return MAILBOX_OAUTH_PROVIDERS.filter((provider) => mailboxOAuthClient(provider, source) !== null)
}

export function isMailboxOAuthProvider(value: unknown): value is MailboxOAuthProvider {
  return typeof value === 'string' && (MAILBOX_OAUTH_PROVIDERS as readonly string[]).includes(value)
}

export const mailboxOAuthRedirectUri = () => `${getAppUrl()}${MAILBOX_OAUTH_CALLBACK_PATH}`

export interface MailboxOAuthState {
  companyId: string
  provider: MailboxOAuthProvider
  userId: string
  /** Expiry, in milliseconds since the epoch. */
  expiresAt: number
}

const sign = (payload: string, key: string, purpose: string) => createHmac('sha256', key).update(`kledg-mailbox-oauth:${purpose}:${payload}`).digest('base64url')

/** A signed state: base64url(JSON).signature. */
export function createMailboxOAuthState(state: Omit<MailboxOAuthState, 'expiresAt'>, key: string, now: Date = new Date()): string {
  const body: MailboxOAuthState & { nonce: string } = {
    ...state,
    expiresAt: now.getTime() + MAILBOX_OAUTH_TTL_SECONDS * 1000,
    nonce: randomBytes(16).toString('base64url'),
  }
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  return `${payload}.${sign(payload, key, 'state')}`
}

/** The state when its signature holds and it has not expired; null otherwise. */
export function readMailboxOAuthState(value: string | null | undefined, key: string, now: Date = new Date()): MailboxOAuthState | null {
  if (!value || value.length > 2048) return null
  const [payload, signature, extra] = value.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const expected = Buffer.from(sign(payload, key, 'state'))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<MailboxOAuthState>
    if (typeof body.companyId !== 'string' || typeof body.userId !== 'string' || !isMailboxOAuthProvider(body.provider) || typeof body.expiresAt !== 'number') return null
    if (body.expiresAt <= now.getTime()) return null
    return {
      companyId: body.companyId,
      provider: body.provider,
      userId: body.userId,
      expiresAt: body.expiresAt,
    }
  } catch {
    return null
  }
}

/** The PKCE verifier of a state (43 characters, RFC 7636 4.1) and its S256 challenge. */
export function pkceOf(state: string, key: string): { verifier: string; challenge: string } {
  const verifier = sign(state, key, 'pkce')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

export function consentUrl(client: MailboxOAuthClient, state: string, key: string, loginHint?: string): string {
  const url = new URL(client.authorizeUrl)
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', mailboxOAuthRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', client.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', pkceOf(state, key).challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  for (const [name, value] of Object.entries(client.consentParams)) url.searchParams.set(name, value)
  if (loginHint) url.searchParams.set('login_hint', loginHint)
  return url.toString()
}

export interface MailboxTokens {
  accessToken: string
  /** Absent when the provider kept the previous one. */
  refreshToken: string | null
  expiresAt: Date
  /** The address of the account, from the ID token; null on a renewal. */
  email: string | null
}

/** The error of a token request: `invalidGrant` when the user revoked the access (sign in again). */
export class MailboxOAuthError extends Error {
  constructor(
    message: string,
    readonly invalidGrant: boolean,
  ) {
    super(message)
    this.name = 'MailboxOAuthError'
  }
}

/**
 * The email of an ID token received straight from the token endpoint over
 * TLS: its signature need not be checked then (OpenID Connect Core 1.0,
 * 3.1.3.7, item 6). Google puts it in `email`, Microsoft in `email` or
 * `preferred_username`.
 */
export function emailOfIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    for (const claim of ['email', 'preferred_username']) {
      const value = claims[claim]
      if (typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value.toLowerCase()
    }
  } catch {
    return null
  }
  return null
}

async function tokenRequest(client: MailboxOAuthClient, params: Record<string, string>, fetcher: typeof fetch, now: Date): Promise<MailboxTokens> {
  const response = await fetcher(client.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      ...params,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof body.access_token !== 'string') {
    const code = typeof body.error === 'string' ? body.error : `http ${response.status}`
    throw new MailboxOAuthError(`token request failed: ${code}`, code === 'invalid_grant')
  }
  const seconds = typeof body.expires_in === 'number' ? body.expires_in : Number(body.expires_in) || 3600
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    expiresAt: new Date(now.getTime() + seconds * 1000),
    email: emailOfIdToken(body.id_token),
  }
}

export function exchangeMailboxCode(client: MailboxOAuthClient, code: string, state: string, key: string, options: { fetch?: typeof fetch; now?: Date } = {}): Promise<MailboxTokens> {
  return tokenRequest(
    client,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: mailboxOAuthRedirectUri(),
      code_verifier: pkceOf(state, key).verifier,
    },
    options.fetch ?? fetch,
    options.now ?? new Date(),
  )
}

export function refreshMailboxToken(client: MailboxOAuthClient, refreshToken: string, options: { fetch?: typeof fetch; now?: Date } = {}): Promise<MailboxTokens> {
  // Microsoft renews for the scopes asked (the IMAP one, not the sign-in ones); Google for those of the consent
  const scope: Record<string, string> =
    client.provider === 'microsoft'
      ? {
          scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
        }
      : {}
  return tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken, ...scope }, options.fetch ?? fetch, options.now ?? new Date())
}
