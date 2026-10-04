'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AiAccessGrants, CompanyAccess, ConnectionAccess } from '@/lib/ai-access/access'
import type { PickerCompany } from './company-access-picker'

/**
 * The companies the signed-in user can access (all of them for instance
 * administrators). `error` is set when they could not be loaded, so a failed
 * request is never shown as "no company".
 */
export function useMyCompanies() {
  const [companies, setCompanies] = useState<PickerCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/companies', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`GET /api/companies: ${r.status}`)
        return (await r.json()) as Array<{ id: string; name: string; siren?: string | null }>
      })
      .then((data) => {
        if (!cancelled) setCompanies(data.map(({ id, name, siren }) => ({ id, name, siren })))
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { companies, loading, error }
}

/** Saved grants (companies and execution mode) of the user's assistants and API keys, by client id and key id. */
export function useAiAccessGrants() {
  const [grants, setGrants] = useState<{ assistants: Map<string, ConnectionAccess>; apiKeys: Map<string, ConnectionAccess> }>({
    assistants: new Map(),
    apiKeys: new Map(),
  })
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-access/grants', { cache: 'no-store' })
      if (!response.ok) return
      const data = (await response.json()) as AiAccessGrants
      setGrants({
        assistants: new Map(data.assistants.map(({ clientId, ...access }) => [clientId, access])),
        apiKeys: new Map(data.apiKeys.map(({ apiKeyId, ...access }) => [apiKeyId, access])),
      })
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { ...grants, loading, loaded, reload: load }
}

/** PUT a JSON body; throws the API's French error message on failure. */
export async function putAccess(url: string, body: unknown): Promise<CompanyAccess> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { error?: string }).error ?? "L'accès n'a pas pu être enregistré. Réessayez.")
  return data as CompanyAccess
}
