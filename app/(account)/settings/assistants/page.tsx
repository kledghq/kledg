'use client'

import { useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { PageHeader } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { McpConnectCard } from '@/components/features/settings/mcp-connect-card'
import { OAuthConnectionsCard } from '@/components/features/settings/oauth-connections-card'
import { useAssistantConnections } from '@/components/features/settings/use-assistant-connections'
import { useAiAccessGrants, useMyCompanies } from '@/components/features/settings/use-ai-access'

/**
 * Assistants IA: how to connect Claude, ChatGPT or Claude Code to this
 * instance, and the assistants authorized through OAuth with their access,
 * execution mode and companies. API keys have their own page (Clés API).
 */
export default function AssistantsPage() {
  const assistants = useAssistantConnections()
  const grants = useAiAccessGrants()
  const { companies, loading: companiesLoading } = useMyCompanies()
  // Only to mark the Claude Code tab as connected when a key exists.
  const [hasApiKey, setHasApiKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    authClient.apiKey.list().then(({ data }) => {
      const payload = data as unknown as { apiKeys?: unknown[] } | unknown[] | null
      const keys = Array.isArray(payload) ? payload : (payload?.apiKeys ?? [])
      if (!cancelled) setHasApiKey(keys.length > 0)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Assistants IA"
        description="Connectez Claude ou ChatGPT à votre comptabilité, et choisissez ce que chacun peut faire et sur quelles sociétés."
        docsHref={docsUrl('aiAssistants')}
      />

      <McpConnectCard connected={new Set(assistants.consents.map((c) => c.kind))} hasApiKey={hasApiKey} />
      <OAuthConnectionsCard
        consents={assistants.consents}
        loading={assistants.loading}
        onChange={assistants.reload}
        grants={grants.assistants}
        companies={companies}
        companiesLoading={companiesLoading}
        onGrantChange={grants.reload}
      />
    </div>
  )
}
