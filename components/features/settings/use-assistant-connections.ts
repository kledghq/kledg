'use client'

import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { assistantKind as kindOfClient, type AssistantKind } from '@/lib/ai-access/assistant-kind'

export type { AssistantKind }

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

/** Which assistant an OAuth client is (lib/ai-access/assistant-kind.ts); the declared metadata never decides it. */
export function assistantKind(clientId: string, _client?: PublicClient | null): AssistantKind {
  return kindOfClient(clientId)
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
