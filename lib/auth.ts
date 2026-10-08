import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { organization, admin, jwt } from 'better-auth/plugins'
import { apiKey } from '@better-auth/api-key'
import { mcp } from '@better-auth/mcp'
import { cimd } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import { nextCookies } from 'better-auth/next-js'
import { waitUntil } from '@vercel/functions'
import { authPrisma } from './auth-prisma'
import { ac, roles } from './permissions'
import { getAppUrl, getMcpResourceUrl, getTrustedOrigins } from './config'
import { sendEmail } from './email'
import { changeEmailVerificationEmail, resetPasswordEmail, verifyEmailEmail, welcomeEmail } from './email/templates'
import { actionRefusalMessage, authActionOf, isActionAllowed } from './instance'
import { REQUIRE_EMAIL_VERIFICATION } from './instance/policy'
import { authRateLimit, isAccountRouteOnlyPath, isOrganizationMutationPath, isUserRouteOnlyPath } from './auth-policy'
import { isEmailChangeToken } from './account/verification-token'
import { isWelcomeReset } from './email/welcome-context'
import { revokeDelegatedAccess } from './account/revoke-delegated-access'
import { checkAccountDeletion } from './account/deletion-guards'
import { prisma } from './prisma'
import { CLIENT_IP_HEADER } from './client-ip'
import { logger } from './logger'
import { resilientSingleton } from './resilient-singleton'

/** Lifetime of the session cookie cache (see `session.cookieCache` below and docs/configuration.md). */
export const SESSION_COOKIE_CACHE_SECONDS = 60

/** The user whose password a successful Better Auth call just changed, if any. */
function passwordChangedFor(path: string | undefined, returned: unknown, body: unknown): string | null {
  if (!returned || returned instanceof APIError || returned instanceof Response) return null
  if (path === '/change-password') {
    const id = (returned as { user?: { id?: unknown } }).user?.id
    return typeof id === 'string' ? id : null
  }
  if (path === '/admin/set-user-password') {
    const id = (body as { userId?: unknown } | undefined)?.userId
    return typeof id === 'string' ? id : null
  }
  return null
}

function createAuth() {
  return betterAuth({
  database: prismaAdapter(authPrisma, { provider: 'postgresql' }),
  baseURL: getAppUrl(),
  trustedOrigins: getTrustedOrigins(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 10,
    // Accounts are created by the instance administrator (or by /setup for the
    // very first one): there is no public sign-up on a self-hosted instance.
    disableSignUp: true,
    // An instance whose policy requires verified addresses (lib/instance/policy.ts)
    // refuses to sign in an account until its address is confirmed; the
    // sign-in attempt sends the link again (sendOnSignIn below). Kledg: off.
    requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
    // A reset is how a user evicts someone who knows the old password: every
    // session of the account ends, including the one that may be stolen.
    revokeSessionsOnPasswordReset: true,
    // ...and so does everything that acts for the account without a session:
    // API keys and AI assistants (KLEDG-R3-AUTH-01). A change of password
    // does the same (hooks.after below).
    onPasswordReset: async ({ user }) => {
      await revokeDelegatedAccess(user.id)
    },
    sendResetPassword: async ({ user, url }) => {
      // Members added by an administrator get a "welcome" variant of the same
      // link, decided on the server (lib/email/welcome-context.ts), never from
      // the URL a caller may choose (KLEDG-R3-INPUT-06).
      const isWelcome = isWelcomeReset()
      // Sent after the response (KLEDG-SEC-009): Better Auth awaits this hook
      // only for an existing account, so awaiting the delivery would make a
      // known address measurably slower to answer than an unknown one. On
      // Vercel waitUntil keeps the function alive until it is sent; elsewhere
      // the process keeps running anyway. A failure is logged by sendEmail.
      waitUntil(
        sendEmail(isWelcome ? welcomeEmail(user.email, url) : resetPasswordEmail(user.email, url)).catch(() => {}),
      )
    },
  },
  emailVerification: {
    sendOnSignIn: REQUIRE_EMAIL_VERIFICATION,
    sendVerificationEmail: async ({ user, url, token }) => {
      // Email changes (lib/account/change-email.service.ts) reuse this hook
      // with the new address: the link switches the account to it.
      // Sent after the response (KLEDG-R3-AUTH-03, as KLEDG-SEC-009): Better
      // Auth awaits this hook only when the new address is free, so awaiting
      // the delivery would tell a registered address from a free one.
      waitUntil(
        sendEmail(isEmailChangeToken(token) ? changeEmailVerificationEmail(user.email, url) : verifyEmailEmail(user.email, url)).catch(
          () => {},
        ),
      )
    },
  },
  user: {
    // Only through app/api/account (closed over HTTP below): the new address
    // is always verified, never switched directly.
    changeEmail: { enabled: true },
    deleteUser: {
      enabled: true,
      // The guards run on every path that deletes a user through Better Auth.
      beforeDelete: async (user) => {
        const { blockers } = await checkAccountDeletion({
          id: user.id,
          role: (user as { role?: string | null }).role ?? null,
        })
        if (blockers.length > 0) throw new APIError('BAD_REQUEST', { message: blockers.join(' ') })
      },
      // API keys reference their user without a foreign key.
      afterDelete: async (user) => {
        await prisma.apikey.deleteMany({ where: { referenceId: user.id } })
      },
    },
  },
  account: {
    modelName: 'authAccount',
  },
  session: {
    // Signed cookie cache of the session (Better Auth "session_data" cookie):
    // Better Auth skips its session and user reads while the cache is fresh.
    // Kledg's own pages and routes do not rely on it for revocation:
    // getCurrentUser (lib/session.ts) confirms on every request that the
    // session row still exists and reads the role and ban from the database,
    // so a sign out elsewhere, a password reset or change, a ban or a demotion
    // applies at once. Only Better Auth's own read endpoints (get-session)
    // may report a revoked session for at most this many seconds; its
    // sensitive endpoints bypass the cache, and its admin endpoints are
    // closed over HTTP (lib/auth-policy.ts). MCP clients never use cookies.
    cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
  },
  // The OAuth token endpoint is /oauth2/token; the JWT plugin's /token is not needed.
  disabledPaths: ['/token'],
  // Shared across serverless instances (the default store is in memory, per
  // instance). Keys are per client IP and path; see lib/auth-policy.ts.
  rateLimit: authRateLimit,
  advanced: {
    // Only the address resolved by lib/client-ip.ts (trusted proxy
    // configuration), written by app/api/auth over any value the client sent.
    // Without one, Better Auth keys its limits on a single shared bucket.
    // IPv6 clients count per /64 (one subscriber holds the whole prefix) and
    // an IPv4-mapped address as its IPv4 address, the grouping of Kledg's own
    // limits (rateLimitIpSubject, lib/client-ip.ts; KLEDG-R3-CLOUD-07). Set
    // explicitly so a change of Better Auth's default cannot loosen it.
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER], ipv6Subnet: 64 },
  },
  hooks: {
    // Only HTTP calls are checked; in-process calls (seed, admin services) are trusted.
    before: createAuthMiddleware(async (ctx) => {
      if (!ctx.request) return
      // Restrictable actions (password, email, account, users) go through
      // the instance policy (lib/instance/policy.ts, everything allowed by
      // default). The session is only read for these rare paths.
      const action = authActionOf(ctx.path)
      if (action) {
        const user = (await getSessionFromCtx(ctx))?.user as { id: string; email: string; role?: string | null } | undefined
        const actor = user ? { id: user.id, email: user.email, role: user.role ?? null } : null
        if (!(await isActionAllowed(action, actor))) {
          throw new APIError('FORBIDDEN', { message: actionRefusalMessage(action) })
        }
      }
      // KLEDG-R3-AUTH-02: an email change link must not sign in whoever opens
      // it. Better Auth creates a session for the requesting account when the
      // link is opened without one; the link only completes in a browser
      // already signed in to that account (another account is refused by
      // Better Auth), so a signed out browser signs in first and comes back.
      if (ctx.path === '/verify-email') {
        const token = typeof ctx.query?.token === 'string' ? ctx.query.token : ''
        if (isEmailChangeToken(token) && !(await getSessionFromCtx(ctx))) {
          const back = `/api/auth/verify-email?${new URL(ctx.request.url).searchParams.toString()}`
          throw ctx.redirect(`/login?error=SIGN_IN_TO_CONFIRM_EMAIL&redirect=${encodeURIComponent(back)}`)
        }
      }
      // The lifetime of an API key is set when it is created (app/api/ai-access/api-keys):
      // a key that writes always expires, so it cannot be extended or cleared afterwards (KLEDG-R3-AUTH-01).
      if (ctx.path === '/api-key/update' && (ctx.body as { expiresIn?: unknown } | undefined)?.expiresIn !== undefined) {
        throw new APIError('FORBIDDEN', { message: 'La durée de validité d’une clé API ne se change pas : créez une nouvelle clé.' })
      }
      if (isAccountRouteOnlyPath(ctx.path)) {
        throw new APIError('FORBIDDEN', { message: 'Utilisez la page Profil de Kledg pour cette action.' })
      }
      if (isUserRouteOnlyPath(ctx.path)) {
        throw new APIError('FORBIDDEN', { message: 'Utilisez la page Utilisateurs de Kledg pour cette action.' })
      }
      // Members and roles are managed through the app's own routes: instance
      // administrators (app/api/companies/[id]/members) and the invitations of
      // company administrators (app/api/companies/[id]/invitations). Better Auth's
      // organization endpoints that change members, invitations, roles or
      // organizations are closed to everyone else.
      if (isOrganizationMutationPath(ctx.path)) {
        const session = await getSessionFromCtx(ctx)
        if ((session?.user as { role?: string | null } | undefined)?.role !== 'admin') {
          throw new APIError('FORBIDDEN', {
            message: "Action réservée aux administrateurs de l'instance.",
          })
        }
      }
    }),
    // KLEDG-R3-AUTH-01: a new password evicts whoever knew the old one or
    // held a session, API keys and AI assistants included (the reset path is
    // emailAndPassword.onPasswordReset above). Runs for HTTP and in-process
    // calls alike, only when the change succeeded.
    after: createAuthMiddleware(async (ctx) => {
      const userId = passwordChangedFor(ctx.path, ctx.context.returned, ctx.body)
      if (userId) await revokeDelegatedAccess(userId)
    }),
  },
  plugins: [
    apiKey({
      defaultPrefix: 'kledg_',
      // MCP clients make many calls per conversation: 300 requests per minute,
      // counted here when Better Auth verifies a key (first use, then once a
      // minute) and on every call in the shared rateLimit table
      // (lib/mcp/api-key.ts), which avoids two writes on the key row per call.
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 300 },
    }),
    // JWKS for the OAuth access tokens of the MCP endpoint. The "set-auth-jwt"
    // header on every session read is not used by any client: it cost a JWKS
    // query and a signature on each authenticated request.
    jwt({ disableSettingJwtHeader: true }),
    // OAuth 2.1 authorization server for the MCP endpoint (/api/mcp), so that
    // Claude, ChatGPT and other MCP clients can connect to this instance.
    mcp({
      loginPage: '/login',
      consentPage: '/consent',
      resource: getMcpResourceUrl(),
      resources: [
        { identifier: getMcpResourceUrl(), name: 'Kledg MCP', allowedScopes: ['kledg:read', 'kledg:write', 'kledg:admin'] },
      ],
      // kledg:read lets an assistant read the books; kledg:write lets it
      // propose draft entries; kledg:admin (full control) lets it act like the
      // user (lib/ai-access/access.ts, lib/mcp/tools.ts).
      scopes: ['openid', 'profile', 'email', 'offline_access', 'kledg:read', 'kledg:write', 'kledg:admin'],
      // Claude and ChatGPT register themselves dynamically (RFC 7591).
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
    }),
    // MCP 2026-07-28 clients identify themselves with a metadata document URL.
    cimd({
      fetchClientMetadataResource,
      metadataProfile: 'mcp-2026-07-28',
    }),
    organization({
      ac,
      roles,
      // Companies (and their organizations) are created by instance administrators only.
      allowUserToCreateOrganization: false,
    }),
    admin(),
    // Must stay last: writes the cookies Better Auth sets during server-side
    // calls (route handlers) to the response, so the session cookie cache is
    // refreshed by API calls too, not only by full page loads. Skipped while
    // rendering server components, where cookies cannot be written.
    nextCookies(),
  ],
})
}

/**
 * The Better Auth instance. Its context starts with a database query (the
 * OAuth provider seeds the MCP resource): when that query fails while the
 * database wakes up, the instance is dropped and made again on the next
 * request instead of failing every request of the server process
 * (lib/resilient-singleton.ts explains the incident).
 */
export const auth = resilientSingleton(
  createAuth,
  (instance) => instance.$context,
  (error) => logger.error('Better Auth initialization failed, retrying on the next request:', error),
)

export type Session = typeof auth.$Infer.Session
