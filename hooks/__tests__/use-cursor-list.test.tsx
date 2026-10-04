import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LoadMore } from '@/components/shared'
import { responseError, useCursorList, type CursorPage } from '../use-cursor-list'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useCursorList', () => {
  it('loads the first page, then appends the next ones until the last', async () => {
    const pages: Record<string, CursorPage<number, { before: number }>> = {
      first: { items: [1, 2], nextCursor: 'c2', meta: { before: 10 } },
      c2: { items: [3, 4], nextCursor: 'c4' },
      c4: { items: [5], nextCursor: null },
    }
    const fetchPage = vi.fn(async (cursor: string | null) => pages[cursor ?? 'first'])
    const { result } = renderHook(() => useCursorList('q', fetchPage))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.items).toEqual([1, 2]))
    expect(result.current.meta).toEqual({ before: 10 })
    expect(result.current.hasMore).toBe(true)

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual([1, 2, 3, 4]))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual([1, 2, 3, 4, 5]))
    expect(result.current.hasMore).toBe(false)
    // The meta of the first page stays: it describes the whole list
    expect(result.current.meta).toEqual({ before: 10 })
    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual([null, 'c2', 'c4'])
  })

  it('starts over when the query changes and ignores the answer of the older query', async () => {
    const slow = deferred<CursorPage<string>>()
    const fetchPage = vi.fn((cursor: string | null, signal: AbortSignal) => {
      void cursor
      return fetchPage.mock.calls.length === 1 ? slow.promise : Promise.resolve({ items: [`new ${signal.aborted}`], nextCursor: null })
    })
    const { result, rerender } = renderHook(({ q }) => useCursorList(q, fetchPage), { initialProps: { q: 'a' } })

    rerender({ q: 'b' })
    await waitFor(() => expect(result.current.items).toEqual(['new false']))
    // The first request was aborted; its late answer changes nothing
    expect(fetchPage.mock.calls[0][1].aborted).toBe(true)
    await act(async () => slow.resolve({ items: ['old'], nextCursor: 'x' }))
    expect(result.current.items).toEqual(['new false'])
    expect(result.current.hasMore).toBe(false)
  })

  it('reports a failed first page and a failed next page separately', async () => {
    let fail = true
    const fetchPage = vi.fn(async (cursor: string | null) => {
      if (fail) throw new Error('Exercice introuvable')
      return cursor ? { items: [2], nextCursor: null } : { items: [1], nextCursor: 'c' }
    })
    const { result } = renderHook(() => useCursorList('q', fetchPage))
    await waitFor(() => expect(result.current.error).toBe('Exercice introuvable'))
    expect(result.current.loading).toBe(false)

    fail = false
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.items).toEqual([1]))
    expect(result.current.error).toBeNull()

    fail = true
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.loadMoreError).toBe('Exercice introuvable'))
    // Loaded rows stay; the next attempt can succeed
    expect(result.current.items).toEqual([1])
    fail = false
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual([1, 2]))
    expect(result.current.loadMoreError).toBeNull()
  })

  it('waits while disabled', async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], nextCursor: null }))
    const { result, rerender } = renderHook(({ enabled }) => useCursorList('q', fetchPage, enabled), {
      initialProps: { enabled: false },
    })
    expect(result.current.loading).toBe(false)
    expect(fetchPage).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.items).toEqual([1]))
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

describe('responseError', () => {
  it('reads the French message of the API or falls back', async () => {
    expect(await responseError(new Response(JSON.stringify({ error: 'Montant invalide' }), { status: 400 }), 'x')).toBe('Montant invalide')
    expect(await responseError(new Response('<html>', { status: 502 }), 'Le serveur ne répond pas')).toBe('Le serveur ne répond pas')
  })
})

describe('LoadMore', () => {
  it('shows the summary and loads the next page on click', async () => {
    const onLoadMore = vi.fn()
    render(<LoadMore hasMore loading={false} onLoadMore={onLoadMore} summary="50 écritures affichées" auto={false} />)
    expect(screen.getByText('50 écritures affichées')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Charger plus' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('offers a retry after a failed page and nothing to load on the last page', () => {
    const { rerender } = render(<LoadMore hasMore loading={false} error="Le chargement a échoué." onLoadMore={vi.fn()} />)
    expect(screen.getByText('Le chargement a échoué.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()

    rerender(<LoadMore hasMore={false} loading={false} onLoadMore={vi.fn()} summary="12 écritures" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('12 écritures')).toBeInTheDocument()
  })

  it('loads by itself when the end of the list comes into view', () => {
    const observers: Array<{ callback: IntersectionObserverCallback }> = []
    class Observer {
      constructor(public callback: IntersectionObserverCallback) {
        observers.push(this)
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    const onLoadMore = vi.fn()
    render(<LoadMore hasMore loading={false} onLoadMore={onLoadMore} />)
    observers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
