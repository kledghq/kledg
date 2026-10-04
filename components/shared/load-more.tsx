'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface LoadMoreProps {
  /** More rows exist on the server. */
  hasMore: boolean
  loading: boolean
  /** Message of a failed page: shown with a retry instead of loading again by itself. */
  error?: string | null
  onLoadMore: () => void
  /** What is shown so far, e.g. "120 écritures affichées". */
  summary?: React.ReactNode
  /**
   * Loads the next page when the end of the list scrolls into view (infinite
   * scroll). The button stays for keyboard users and as a fallback.
   */
  auto?: boolean
  className?: string
}

/**
 * Footer of a cursor list: how many rows are shown and "Charger plus" while
 * the server has more. Long lists load page by page instead of all at once.
 */
export function LoadMore({ hasMore, loading, error, onLoadMore, summary, auto = true, className }: LoadMoreProps) {
  const sentinel = React.useRef<HTMLDivElement>(null)
  const load = React.useRef(onLoadMore)
  React.useEffect(() => {
    load.current = onLoadMore
  })

  React.useEffect(() => {
    const node = sentinel.current
    if (!auto || !hasMore || loading || error || !node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) load.current()
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [auto, hasMore, loading, error])

  if (!hasMore && !summary) return null

  return (
    <div
      data-slot="load-more"
      className={cn('flex flex-wrap items-center justify-between gap-2 pt-3', className)}
    >
      <div ref={sentinel} aria-hidden className="h-px w-full" />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {error ? <span className="text-destructive">{error}</span> : summary}
      </p>
      {hasMore ? (
        <Button variant="outline" size="sm" loading={loading} onClick={onLoadMore}>
          {error ? 'Réessayer' : 'Charger plus'}
        </Button>
      ) : null}
    </div>
  )
}
