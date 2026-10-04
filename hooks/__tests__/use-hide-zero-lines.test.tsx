/**
 * "Masquer les lignes à zéro" of the statement pages: on by default,
 * remembered per user in localStorage, a choice made for one user never
 * applies to another, and blocked storage keeps the choice for the page.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ data: null as { user: { id: string } } | null }))
vi.mock('@/lib/auth-client', () => ({ useSession: () => session }))

import { useHideZeroLines } from '@/hooks/use-hide-zero-lines'

const KEY = 'kledg:user-1:reports:hide-zero-lines'

/** In-memory localStorage: the one of the test environment is not always usable. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value))
  }
}

class BlockedStorage extends MemoryStorage {
  getItem(): string | null {
    throw new DOMException('blocked', 'SecurityError')
  }
  setItem(): void {
    throw new DOMException('blocked', 'SecurityError')
  }
}

describe('useHideZeroLines', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    session.data = { user: { id: 'user-1' } }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides zero lines by default and remembers the choice of the user', () => {
    const { result } = renderHook(() => useHideZeroLines())
    expect(result.current[0]).toBe(true)

    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('false')

    // A new page reads the stored choice.
    const { result: next } = renderHook(() => useHideZeroLines())
    expect(next.current[0]).toBe(false)
  })

  it('keeps the choices of each user apart', () => {
    window.localStorage.setItem(KEY, 'false')
    const { result, rerender } = renderHook(() => useHideZeroLines())
    expect(result.current[0]).toBe(false)

    session.data = { user: { id: 'user-2' } }
    rerender()
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(window.localStorage.getItem('kledg:user-2:reports:hide-zero-lines')).toBe('false')

    // Back to the first user: a choice made for user-2 does not leak.
    window.localStorage.setItem(KEY, 'true')
    session.data = { user: { id: 'user-1' } }
    rerender()
    expect(result.current[0]).toBe(true)
  })

  it('without a session, keeps the choice for the page only', () => {
    session.data = null
    const { result } = renderHook(() => useHideZeroLines())
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.length).toBe(0)
  })

  it('works when storage is blocked (private window)', () => {
    vi.stubGlobal('localStorage', new BlockedStorage())
    const { result } = renderHook(() => useHideZeroLines())
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    expect(result.current[0]).toBe(false)
  })
})
