import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPwaCaches } from '@/components/pwa/install'

function fakeCaches(names: string[]) {
  const store = new Set(names)
  return {
    store,
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (name: string) => store.delete(name)),
  }
}

describe('clearPwaCaches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('on sign out, deletes the assets stored while browsing and keeps the offline shell', async () => {
    const caches = fakeCaches(['kledg-static-b1', 'kledg-static-b0', 'kledg-shell-b1', 'other-app'])
    vi.stubGlobal('caches', caches)
    await clearPwaCaches()
    expect([...caches.store].sort()).toEqual(['kledg-shell-b1', 'other-app'])
  })

  it('with the kill switch, deletes every cache of the worker, and only those', async () => {
    const caches = fakeCaches(['kledg-static-b1', 'kledg-shell-b1', 'other-app'])
    vi.stubGlobal('caches', caches)
    await clearPwaCaches({ all: true })
    expect([...caches.store]).toEqual(['other-app'])
  })
})
