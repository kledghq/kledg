'use client'

import * as React from 'react'

import type { ServedSource, WidgetDataBySource } from '@/lib/dashboard/load-widget-data.service'
import { useCompanyOnboarding } from '@/components/features/onboarding/use-company-onboarding'

/**
 * Data of the dashboard widgets, one request per source
 * (GET /api/dashboard/widgets?source=). A source is fetched the first time a
 * visible widget asks for it, then shared by every widget that reads it, so
 * the four ledger indicators make one request. Sources load in parallel and
 * independently: a slow or failing one only affects its own widgets.
 */

export type SourceState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

interface DashboardDataContext {
  companyId: string
  fiscalYearId: string
  states: Record<string, SourceState<unknown>>
  request: (source: ServedSource, force?: boolean) => void
  onboarding: ReturnType<typeof useCompanyOnboarding>
}

const Context = React.createContext<DashboardDataContext | null>(null)

const keyOf = (source: string, fiscalYearId: string) => `${source}|${fiscalYearId}`

const FALLBACK_ERROR = "Ces données ne se sont pas chargées. Réessayez dans un instant."

async function fetchSource(companyId: string, source: ServedSource, fiscalYearId: string): Promise<unknown> {
  const query = new URLSearchParams({ companyId, source })
  if (fiscalYearId) query.set('fiscalYearId', fiscalYearId)
  const response = await fetch(`/api/dashboard/widgets?${query.toString()}`)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || FALLBACK_ERROR)
  }
  return response.json()
}

export function DashboardDataProvider({
  companyId,
  fiscalYearId,
  onboarding,
  children,
}: {
  companyId: string
  fiscalYearId: string
  onboarding: ReturnType<typeof useCompanyOnboarding>
  children: React.ReactNode
}) {
  const [states, setStates] = React.useState<Record<string, SourceState<unknown>>>({})
  // Requests started, by key: a source is fetched once per fiscal year unless retried.
  const started = React.useRef(new Map<string, number>())

  const request = React.useCallback(
    (source: ServedSource, force = false) => {
      const key = keyOf(source, fiscalYearId)
      if (started.current.has(key) && !force) return
      const attempt = (started.current.get(key) ?? 0) + 1
      started.current.set(key, attempt)
      if (force) setStates((current) => ({ ...current, [key]: { status: 'loading' } }))
      fetchSource(companyId, source, fiscalYearId).then(
        (data) => {
          if (started.current.get(key) === attempt) setStates((current) => ({ ...current, [key]: { status: 'ready', data } }))
        },
        (error: unknown) => {
          if (started.current.get(key) !== attempt) return
          const message = error instanceof Error && error.message !== 'Failed to fetch' ? error.message : FALLBACK_ERROR
          setStates((current) => ({ ...current, [key]: { status: 'error', message } }))
        },
      )
    },
    [companyId, fiscalYearId],
  )

  const value = React.useMemo(
    () => ({ companyId, fiscalYearId, states, request, onboarding }),
    [companyId, fiscalYearId, states, request, onboarding],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

function useDashboardContext(): DashboardDataContext {
  const context = React.useContext(Context)
  if (!context) throw new Error('useWidgetSource must be used inside DashboardDataProvider')
  return context
}

/** The state of one source, fetched on first use; `retry` fetches it again. */
export function useWidgetSource<S extends ServedSource>(source: S) {
  const { fiscalYearId, states, request, companyId } = useDashboardContext()
  React.useEffect(() => {
    request(source)
  }, [request, source])
  const state = (states[keyOf(source, fiscalYearId)] ?? { status: 'loading' }) as SourceState<WidgetDataBySource[S]>
  const retry = React.useCallback(() => request(source, true), [request, source])
  return { state, retry, companyId }
}

export function useDashboardOnboarding() {
  const { onboarding, companyId } = useDashboardContext()
  return { ...onboarding, companyId }
}
