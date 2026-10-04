import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMPACT_LAYOUT_QUERY, useCompactLayout, useMediaQuery } from '@/hooks/ui/use-media-query'

/** A controllable matchMedia: `set(true)` makes the query match and notifies listeners. */
function stubMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  const queries: string[] = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      queries.push(query)
      return {
        get matches() {
          return matches
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }
    }),
  )
  return {
    queries,
    listeners,
    set(next: boolean) {
      matches = next
      listeners.forEach((listener) => listener())
    },
  }
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows the query as the window changes', () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(result.current).toBe(false)
    act(() => media.set(true))
    expect(result.current).toBe(true)
    act(() => media.set(false))
    expect(result.current).toBe(false)
  })

  it('stops listening on unmount', () => {
    const media = stubMatchMedia(true)
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(media.listeners.size).toBe(1)
    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('is false without matchMedia (server, old test environments): the wide layout', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(result.current).toBe(false)
  })

  it('compact layout means below 1024px', () => {
    const media = stubMatchMedia(true)
    const { result } = renderHook(() => useCompactLayout())
    expect(result.current).toBe(true)
    expect(media.queries).toContain(COMPACT_LAYOUT_QUERY)
    expect(COMPACT_LAYOUT_QUERY).toBe('(max-width: 63.99rem)')
  })
})
