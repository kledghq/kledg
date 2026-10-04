'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Client side of the cursor lists (GET /api/entries, GET /api/transactions):
 * loads the first page, appends the next pages on demand and starts over when
 * the query changes. Filters are part of the query, so they run on the server
 * and the browser never downloads rows it does not show.
 *
 * Responses that arrive after the query changed are dropped (each request is
 * aborted when a newer one starts), so fast typing in a filter never shows the
 * rows of an older query.
 */

export interface CursorPage<T, M = undefined> {
  items: T[]
  /** Cursor of the next page, null on the last page. */
  nextCursor: string | null
  /** Data of the first page that applies to the whole list (balance before the period). */
  meta?: M
}

export type FetchCursorPage<T, M = undefined> = (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T, M>>

export interface CursorList<T, M = undefined> {
  items: T[]
  meta: M | undefined
  /** First page loading (skeleton). */
  loading: boolean
  /** A next page loading (spinner on "Charger plus"). */
  loadingMore: boolean
  /** Error of the first page: nothing to show but the message and a retry. */
  error: string | null
  /** Error of a next page: the loaded rows stay, "Charger plus" retries. */
  loadMoreError: string | null
  hasMore: boolean
  loadMore: () => void
  /** Reloads from the first page (after a change made on the page). */
  reload: () => void
}

/** French message of a failed response: the API's `{ error }` when there is one. */
export async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {
    // not JSON: keep the fallback
  }
  return fallback
}

const LOAD_ERROR = 'Le chargement a échoué. Vérifiez votre connexion puis réessayez.'

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : LOAD_ERROR
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/**
 * @param queryKey  Serialized query (filters): a new value starts over from the first page.
 * @param fetchPage Loads one page; throw an Error with a French message on failure.
 * @param enabled   False while the query is not ready (no company, fiscal year still loading).
 */
export function useCursorList<T, M = undefined>(
  queryKey: string,
  fetchPage: FetchCursorPage<T, M>,
  enabled = true,
): CursorList<T, M> {
  const [generation, setGeneration] = useState(0)
  const requestKey = `${generation}:${queryKey}`
  // Result of the last first page, tagged with the query it answers: the list
  // is loading while that tag differs from the current query.
  const [list, setList] = useState<{ key: string | null; items: T[]; meta?: M; cursor: string | null; error: string | null }>({
    key: null,
    items: [],
    cursor: null,
    error: null,
  })
  const [more, setMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })

  const fetchRef = useRef(fetchPage)
  useEffect(() => {
    fetchRef.current = fetchPage
  })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!enabled) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    fetchRef
      .current(null, current.signal)
      .then((page) => {
        if (current.signal.aborted) return
        setMore({ loading: false, error: null })
        setList({ key: requestKey, items: page.items, meta: page.meta, cursor: page.nextCursor, error: null })
      })
      .catch((reason: unknown) => {
        if (current.signal.aborted || isAbort(reason)) return
        setMore({ loading: false, error: null })
        setList({ key: requestKey, items: [], cursor: null, error: messageOf(reason) })
      })
    return () => current.abort()
  }, [requestKey, enabled])

  const loading = enabled && list.key !== requestKey
  const cursor = loading ? null : list.cursor

  const loadMore = useCallback(() => {
    if (!cursor || more.loading) return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setMore({ loading: true, error: null })
    fetchRef
      .current(cursor, current.signal)
      .then((page) => {
        if (current.signal.aborted) return
        setList((previous) => ({ ...previous, items: [...previous.items, ...page.items], cursor: page.nextCursor }))
        setMore({ loading: false, error: null })
      })
      .catch((reason: unknown) => {
        if (current.signal.aborted || isAbort(reason)) return
        setMore({ loading: false, error: messageOf(reason) })
      })
  }, [cursor, more.loading])

  const reload = useCallback(() => setGeneration((n) => n + 1), [])

  return {
    // While a new query loads, the rows of the previous one are not shown
    items: loading ? [] : list.items,
    meta: loading ? undefined : list.meta,
    loading,
    loadingMore: more.loading,
    error: loading ? null : list.error,
    loadMoreError: more.error,
    hasMore: cursor !== null,
    loadMore,
    reload,
  }
}
