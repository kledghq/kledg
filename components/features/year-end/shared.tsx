'use client'

import * as React from 'react'
import { StatusBadge, type StatusTone } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { STATUS_LABELS, type AdjustmentStatus } from '@/lib/year-end/inventory'

const TONES: Record<AdjustmentStatus, StatusTone> = {
  not_in_year: 'neutral',
  to_assess: 'warning',
  up_to_date: 'success',
  to_post: 'warning',
  draft: 'info',
  validated: 'success',
  to_correct: 'danger',
}

/** Where a provision, impairment or grant stands at the closing. */
export function AdjustmentBadge({ status }: { status: AdjustmentStatus }) {
  return <StatusBadge tone={TONES[status]}>{STATUS_LABELS[status]}</StatusBadge>
}

/**
 * Loads JSON from `url` (nothing while it is null), with the three states of
 * a client fetch: loading, error (French message from the API) and data.
 * `reload` fetches again; the previous data stays shown meanwhile.
 */
export function useJson<T>(url: string | null, fallback: string) {
  const [data, setData] = React.useState<T | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const [answered, setAnswered] = React.useState<string | null>(null)
  const key = url ? `${url}#${version}` : null

  React.useEffect(() => {
    if (!url || !key) return
    let cancelled = false
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, fallback))
        return response.json() as Promise<T>
      })
      .then((value) => {
        if (cancelled) return
        setData(value)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setAnswered(key))
    return () => {
      cancelled = true
    }
  }, [url, key, fallback])

  return { data, error, loading: key !== null && answered !== key, reload: () => setVersion((v) => v + 1) }
}

/** Sends JSON and returns the parsed answer (null for 204), or throws the French message of the API. */
export async function sendJson<T>(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown, fallback: string): Promise<T | null> {
  const response = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return response.status === 204 ? null : ((await response.json()) as T)
}

/** Euros of an amount in cents, for the Amount component. */
export const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : cents / 100)
