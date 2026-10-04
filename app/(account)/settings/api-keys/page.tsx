'use client'

import { useCallback, useEffect, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PageHeader } from '@/components/shared'
import { docsUrl } from '@/lib/docs-links'
import { ApiKeysCard, NewApiKeyCard, type ApiKey } from '@/components/features/settings/api-keys-card'
import { useAiAccessGrants, useMyCompanies } from '@/components/features/settings/use-ai-access'

/**
 * Clés API: creation (level, execution mode for full control, companies) and
 * the active keys. Claude and ChatGPT connect without a key, from the
 * Assistants IA page.
 */
export default function ApiKeysPage() {
  const grants = useAiAccessGrants()
  const { companies, loading: companiesLoading } = useMyCompanies()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await authClient.apiKey.list()
    if (error) {
      setError(error.message ?? 'Impossible de charger les clés API')
    } else {
      const payload = data as unknown as { apiKeys?: ApiKey[] } | ApiKey[] | null
      setKeys(Array.isArray(payload) ? payload : (payload?.apiKeys ?? []))
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reloadKeys = async () => {
    await Promise.all([load(), grants.reload()])
  }

  return (
    <div className="w-full max-w-3xl space-y-6">
      <PageHeader
        title="Clés API"
        description="Pour Claude Code, Claude Desktop ou vos scripts. Pour Claude ou ChatGPT, aucune clé n'est nécessaire."
        docsHref={docsUrl('aiAssistants')}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <NewApiKeyCard companies={companies} companiesLoading={companiesLoading} onCreated={reloadKeys} />
      <ApiKeysCard
        keys={keys}
        loading={loading}
        grants={grants.apiKeys}
        companies={companies}
        companiesLoading={companiesLoading}
        onChange={reloadKeys}
      />
    </div>
  )
}
