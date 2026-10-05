/**
 * Which assistant an OAuth client is, from its client id alone. Pure module
 * shared by the settings and consent pages (client side) and by the company
 * layout, which offers "Proposer avec l'IA" in the assistants the user
 * connected (lib/ai-access/company-assistants.service.ts).
 */

export type AssistantKind = 'claude' | 'chatgpt' | 'claude-code' | 'other'

/**
 * Client metadata documents (CIMD) of the assistants Kledg brands. Better
 * Auth fetched the document at the client id URL and checked that it names
 * this very URL (@better-auth/cimd), so a client id on one of these origins
 * can only come from Claude or ChatGPT. Exact origin (scheme, host, default
 * port): no subdomain, no look-alike.
 */
const VERIFIED_CLIENT_ORIGINS: ReadonlyArray<{ origin: string; pathPrefix: string; kind: AssistantKind }> = [
  { origin: 'https://claude.ai', pathPrefix: '/oauth/', kind: 'claude' },
  { origin: 'https://chatgpt.com', pathPrefix: '/', kind: 'chatgpt' },
]

/**
 * Which assistant an OAuth client is: Claude or ChatGPT only for a verified
 * identity (a CIMD client id on an allowlisted origin), Claude Code when
 * Claude's metadata document says so. A dynamically registered client
 * (RFC 7591) declares its name, URI and logo itself: it is 'other', whatever
 * it claims.
 */
export function assistantKind(clientId: string): AssistantKind {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return 'other'
  }
  if (url.username || url.password || url.hash) return 'other'
  const match = VERIFIED_CLIENT_ORIGINS.find((v) => url.origin === v.origin && url.pathname.startsWith(v.pathPrefix))
  if (!match) return 'other'
  if (match.kind === 'claude' && url.pathname.includes('claude-code')) return 'claude-code'
  return match.kind
}
