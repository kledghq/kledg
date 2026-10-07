import { requireMcpAuth } from '@better-auth/mcp'
import { auth } from '@/lib/auth'
import { getMcpResourceUrl } from '@/lib/config'
import { prisma } from '@/lib/prisma'
import type { CurrentUser } from '@/lib/session'
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE, apiKeyLevelOf, capabilitiesOf, levelScopes } from '@/lib/ai-access/access'
import { clientIdOf, findConsentScopes, loadCompanyScope, type McpAccess, type McpCaller } from '@/lib/mcp/company-access'
import { withUserContext } from '@/lib/rls/context'
import { RateLimitError } from '@/lib/accounting/errors'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getExecutionMode } from '@/lib/ai-access/manage-grants.service'
import { verifyMcpApiKey } from './api-key'

export type { McpAccess } from '@/lib/mcp/company-access'

/** Kledg API keys start with this prefix (see apiKey() in lib/auth.ts). */
const API_KEY_PREFIX = 'kledg_'

async function loadUser(userId: string): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, banned: true },
  })
  if (!user || user.banned) return null
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

/**
 * 401 for an access token whose assistant was revoked: an RFC 6750
 * invalid_token challenge pointing at the resource metadata (RFC 9728), so
 * the client starts a new authorization instead of retrying the token.
 */
function revokedResponse(): Response {
  const resource = new URL(getMcpResourceUrl())
  const metadata = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname.replace(/\/$/, '')}`
  return Response.json(
    { error: 'Access revoked' },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': `Bearer error="invalid_token", error_description="Access revoked", resource_metadata="${metadata}"`,
      },
    },
  )
}

/**
 * Runs `fn` as the connection's user (row level security, docs/rls.md), its
 * statements narrowed to the companies the connection was granted: the
 * database refuses the other companies even if a tool forgot its check.
 */
async function asConnection<T>(user: CurrentUser, caller: McpCaller, fn: () => Promise<T>): Promise<T> {
  return withUserContext(user.id, async () => {
    const scope = await loadCompanyScope(user.id, caller)
    return withUserContext(user.id, fn, scope.all ? {} : { companyIds: [...scope.companyIds] })
  })
}

/** 429 of a connection past its calls per minute (API key or OAuth assistant). */
function tooManyCalls(error: RateLimitError): Response {
  return Response.json({ error: error.message }, { status: 429, headers: { 'Retry-After': '60' } })
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

/**
 * Authenticates an MCP request, either with a Kledg API key (Claude Code,
 * Claude Desktop, scripts) or with an OAuth access token issued by this
 * instance (claude.ai, ChatGPT and other connectors), then runs the handler
 * as that user. The caller (OAuth client id or API key id) is passed on so
 * every tool applies the connection's company grant (lib/mcp/company-access.ts).
 */
export function withMcpUser(handler: (request: Request, access: McpAccess) => Promise<Response>) {
  const oauthProtected = requireMcpAuth(
    auth,
    async (request, claims) => {
      const user = claims.sub ? await loadUser(claims.sub) : null
      const clientId = clientIdOf(claims as Record<string, unknown>)
      if (!user || !clientId) return Response.json({ error: 'Unknown user' }, { status: 401 })
      // Same ceiling as an API key (lib/mcp/api-key.ts), per user and assistant: a looping client stops at 300 calls a minute.
      try {
        await enforceRateLimit('mcp-oauth', `${user.id}:${clientId}`)
      } catch (error) {
        if (error instanceof RateLimitError) return tooManyCalls(error)
        throw error
      }
      return withUserContext(user.id, async () => {
        // JWT access tokens are stateless: the consent is checked on every call,
        // so a revoked assistant is refused at once and a lowered access level
        // applies to tokens issued before it (see the
        // 20261006090000_ai_assistant_token_revocation migration for refresh tokens).
        const consented = await findConsentScopes(user.id, clientId)
        if (!consented || !capabilitiesOf(consented).canRead) return revokedResponse()
        // Only what both the token and the current consent grant.
        const granted = String(claims.scope ?? '')
          .split(' ')
          .filter((scope) => consented.includes(scope))
        const { canWrite, canAdmin } = capabilitiesOf(granted)
        // Read on every request: a mode changed in Kledg applies to the next call.
        const caller: McpCaller = { kind: 'oauth', clientId }
        const executionMode = await getExecutionMode(user.id, caller)
        return asConnection(user, caller, () => handler(request, { user, canWrite, canAdmin, caller, executionMode }))
      })
    },
    {
      resource: getMcpResourceUrl(),
      requiredScopes: [READ_SCOPE],
      // Clients ask for every level; the consent page preselects drafts and
      // never full control (lib/ai-access/access.ts, defaultLevel).
      challengeScopes: [READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE],
    },
  )

  return async (request: Request): Promise<Response> => {
    const apiKey = request.headers.get('x-api-key') ?? bearer(request)
    if (apiKey?.startsWith(API_KEY_PREFIX)) {
      let key: Awaited<ReturnType<typeof verifyMcpApiKey>>
      try {
        key = await verifyMcpApiKey(apiKey)
      } catch (error) {
        if (error instanceof RateLimitError) return tooManyCalls(error)
        throw error
      }
      const user = key ? await loadUser(key.referenceId) : null
      if (!key || !user) return Response.json({ error: 'Invalid API key' }, { status: 401 })
      // API keys act with the rights of their owner, within the key's company
      // grant and the level chosen at creation (read and drafts for older keys).
      const { canWrite, canAdmin } = capabilitiesOf(levelScopes(apiKeyLevelOf(key.permissions)))
      const caller: McpCaller = { kind: 'apiKey', apiKeyId: key.id }
      return withUserContext(user.id, async () => {
        const executionMode = await getExecutionMode(user.id, caller)
        return asConnection(user, caller, () => handler(request, { user, canWrite, canAdmin, caller, executionMode }))
      })
    }
    return oauthProtected(request)
  }
}
