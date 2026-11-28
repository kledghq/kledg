/**
 * Signing in to a receipt mailbox with Google or Microsoft
 * (lib/receipts/mailbox/oauth.ts), without a provider:
 * - a provider is offered only when its OAuth client is configured;
 * - the consent URL asks for the IMAP scope, a refresh token and PKCE S256;
 * - the state is signed and expires: a changed byte, another key or a late
 *   return is refused;
 * - the code exchange sends the PKCE verifier, reads the account's address
 *   from the ID token, and a revoked access is told apart.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  availableMailboxOAuthProviders,
  consentUrl,
  createMailboxOAuthState,
  emailOfIdToken,
  exchangeMailboxCode,
  mailboxOAuthClient,
  MAILBOX_OAUTH_TTL_SECONDS,
  pkceOf,
  readMailboxOAuthState,
  refreshMailboxToken,
} from '../oauth'

const KEY = 'a'.repeat(64)
const NOW = new Date('2026-11-28T08:00:00Z')
const ENV = {
  GOOGLE_MAIL_CLIENT_ID: 'google-client.apps.googleusercontent.com',
  GOOGLE_MAIL_CLIENT_SECRET: 'google-secret',
  MICROSOFT_MAIL_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
  MICROSOFT_MAIL_CLIENT_SECRET: 'microsoft-secret',
}

const idToken = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

function tokenEndpoint(status: number, body: Record<string, unknown>) {
  const calls: Array<{ url: string; form: URLSearchParams }> = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init.body)) })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetcher }
}

describe('the providers offered', () => {
  it('offers a provider only when both its client id and secret are set', () => {
    expect(availableMailboxOAuthProviders({})).toEqual([])
    expect(availableMailboxOAuthProviders({ GOOGLE_MAIL_CLIENT_ID: 'x' })).toEqual([])
    expect(availableMailboxOAuthProviders(ENV)).toEqual(['google', 'microsoft'])
    expect(mailboxOAuthClient('google', ENV)).toMatchObject({ imapHost: 'imap.gmail.com', tokenUrl: 'https://oauth2.googleapis.com/token' })
    expect(mailboxOAuthClient('microsoft', ENV)).toMatchObject({ imapHost: 'outlook.office365.com', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' })
    expect(mailboxOAuthClient('microsoft', { ...ENV, MICROSOFT_MAIL_TENANT: 'contoso.onmicrosoft.com' })?.authorizeUrl).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize')
    // A tenant that would change the URL is not one
    expect(mailboxOAuthClient('microsoft', { ...ENV, MICROSOFT_MAIL_TENANT: '../evil' })).toBeNull()
  })

  it('asks Google for the IMAP scope, a refresh token and PKCE', () => {
    const state = createMailboxOAuthState({ companyId: 'c1', provider: 'google', userId: 'u1' }, KEY, NOW)
    const url = new URL(consentUrl(mailboxOAuthClient('google', ENV)!, state, KEY))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: ENV.GOOGLE_MAIL_CLIENT_ID,
      response_type: 'code',
      scope: 'openid email https://mail.google.com/',
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge_method: 'S256',
    })
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/receipts\/mailbox\/oauth\/callback$/)
    // The challenge is the S256 of the verifier, which only the server can derive
    const { verifier, challenge } = pkceOf(state, KEY)
    expect(url.searchParams.get('code_challenge')).toBe(challenge)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('asks Microsoft for IMAP with offline_access', () => {
    const state = createMailboxOAuthState({ companyId: 'c1', provider: 'microsoft', userId: 'u1' }, KEY, NOW)
    const url = new URL(consentUrl(mailboxOAuthClient('microsoft', ENV)!, state, KEY))
    expect(url.searchParams.get('scope')).toBe('openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All')
  })
})

describe('the state', () => {
  const state = createMailboxOAuthState({ companyId: 'c1', provider: 'google', userId: 'u1' }, KEY, NOW)

  it('comes back with its company, provider and user while it is valid', () => {
    expect(readMailboxOAuthState(state, KEY, NOW)).toEqual({ companyId: 'c1', provider: 'google', userId: 'u1', expiresAt: NOW.getTime() + MAILBOX_OAUTH_TTL_SECONDS * 1000 })
  })

  it('is refused when changed, signed with another key, or late', () => {
    const [payload, signature] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ companyId: 'c2', provider: 'google', userId: 'u1', expiresAt: NOW.getTime() + 60_000 })).toString('base64url')
    expect(readMailboxOAuthState(`${forged}.${signature}`, KEY, NOW)).toBeNull()
    expect(readMailboxOAuthState(`${payload}.${signature}x`, KEY, NOW)).toBeNull()
    expect(readMailboxOAuthState(state, 'b'.repeat(64), NOW)).toBeNull()
    expect(readMailboxOAuthState(state, KEY, new Date(NOW.getTime() + MAILBOX_OAUTH_TTL_SECONDS * 1000))).toBeNull()
    expect(readMailboxOAuthState(null, KEY, NOW)).toBeNull()
    expect(readMailboxOAuthState('not-a-state', KEY, NOW)).toBeNull()
  })
})

describe('the tokens', () => {
  const google = mailboxOAuthClient('google', ENV)!
  const microsoft = mailboxOAuthClient('microsoft', ENV)!

  it('exchanges the code with the PKCE verifier and reads the address from the ID token', async () => {
    const state = createMailboxOAuthState({ companyId: 'c1', provider: 'google', userId: 'u1' }, KEY, NOW)
    const { calls, fetcher } = tokenEndpoint(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3599, id_token: idToken({ email: 'Factures@Atelier.fr' }) })
    const tokens = await exchangeMailboxCode(google, 'code-1', state, KEY, { fetch: fetcher, now: NOW })
    expect(tokens).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: new Date(NOW.getTime() + 3599_000), email: 'factures@atelier.fr' })
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(Object.fromEntries(calls[0].form)).toMatchObject({ grant_type: 'authorization_code', code: 'code-1', client_id: google.clientId, client_secret: 'google-secret', code_verifier: pkceOf(state, KEY).verifier })
  })

  it('renews for the IMAP scope with Microsoft, and tells a revoked access apart', async () => {
    const ok = tokenEndpoint(200, { access_token: 'at-2', refresh_token: 'rt-2', expires_in: '3600' })
    expect(await refreshMailboxToken(microsoft, 'rt-1', { fetch: ok.fetcher, now: NOW })).toMatchObject({ accessToken: 'at-2', refreshToken: 'rt-2', email: null })
    expect(Object.fromEntries(ok.calls[0].form)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1', scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All' })

    const revoked = tokenEndpoint(400, { error: 'invalid_grant' })
    await expect(refreshMailboxToken(google, 'rt-1', { fetch: revoked.fetcher, now: NOW })).rejects.toMatchObject({ name: 'MailboxOAuthError', invalidGrant: true })
    const down = tokenEndpoint(503, {})
    await expect(refreshMailboxToken(google, 'rt-1', { fetch: down.fetcher, now: NOW })).rejects.toMatchObject({ invalidGrant: false })
  })

  it('takes the address from email, else preferred_username, never a name', () => {
    expect(emailOfIdToken(idToken({ preferred_username: 'compta@atelier.onmicrosoft.com' }))).toBe('compta@atelier.onmicrosoft.com')
    expect(emailOfIdToken(idToken({ preferred_username: 'Jean Martin' }))).toBeNull()
    expect(emailOfIdToken('garbage')).toBeNull()
    expect(emailOfIdToken(undefined)).toBeNull()
  })
})
