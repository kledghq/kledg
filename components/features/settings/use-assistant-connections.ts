'use client'

import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'

export type AssistantKind = 'claude' | 'chatgpt' | 'claude-code' | 'other'

export type AssistantConsent = {
  id: string
  clientId: string
  scopes?: string[]
  createdAt?: string
  name: string
  kind: AssistantKind
}

type Consent = { id: string; clientId: string; scopes?: string[]; createdAt?: string }
type PublicClient = { client_name?: string; client_uri?: string }

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
export function assistantKind(clientId: string, _client?: PublicClient | null): AssistantKind {
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

const KNOWN_ASSISTANT_NAMES: Partial<Record<AssistantKind, string>> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  'claude-code': 'Claude Code',
}

/** Host of the URI an unverified client declares (shown as "domaine déclaré"), or null. */
export function declaredDomain(client: PublicClient | null | undefined): string | null {
  const uri = client?.client_uri
  if (!uri) return null
  try {
    const url = new URL(uri)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname : null
  } catch {
    return null
  }
}

/**
 * Assistants authorized on this account through OAuth. Reloads when the tab
 * gets focus again, so returning from Claude or ChatGPT after authorizing
 * shows the new connection without a manual refresh.
 */
export function useAssistantConnections() {
  const [consents, setConsents] = useState<AssistantConsent[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await authClient.$fetch<Consent[]>('/oauth2/get-consents')
    const list = Array.isArray(data) ? data : []
    const named = await Promise.all(
      list.map(async (c) => {
        const { data: client } = await authClient.$fetch<PublicClient>('/oauth2/public-client', {
          query: { client_id: c.clientId },
        })
        const kind = assistantKind(c.clientId, client ?? null)
        const declared = client?.client_name?.trim() || declaredDomain(client) || c.clientId
        return {
          ...c,
          // A name an unverified client declared is labelled as such.
          name: kind === 'other' ? `${declared} (non vérifiée)` : (KNOWN_ASSISTANT_NAMES[kind] ?? declared),
          kind,
        }
      }),
    )
    setConsents(named)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  return { consents, loading, reload: load }
}
