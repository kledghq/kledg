/**
 * Better Auth keeps the session in nanostores, which unmount a store one
 * second after its last listener leaves (STORE_UNMOUNT_DELAY). In a jsdom test
 * file that ends sooner, that unmount ran after the environment was torn down
 * and the session refresh cleanup failed the run with "window is not defined".
 * vitest.setup.ts unmounts the session store after each file instead, with
 * nanostores' own test cleanup (the store's `clean` hook).
 */

import { authClient } from '@/lib/auth-client'

type SessionStore = object & { active?: boolean; listen: unknown }

/**
 * The auth client's session store, or null when a test mocks the client
 * without it. Better Auth's client is a proxy that returns an atom only when
 * asked by name, so the store is read as `$store.atoms.session`.
 */
export function authClientSessionStore(): SessionStore | null {
  try {
    const atom = (authClient as unknown as { $store?: { atoms?: { session?: unknown } } } | undefined)?.$store?.atoms?.session
    return atom && typeof atom === 'object' && typeof (atom as SessionStore).listen === 'function' ? (atom as SessionStore) : null
  } catch {
    // vi.mock('@/lib/auth-client') without authClient throws on access
    return null
  }
}

/** Runs the pending unmount of the session store now. */
export function unmountAuthClientStores(): void {
  const store = authClientSessionStore()
  if (!store) return
  const clean = Object.getOwnPropertySymbols(store).find((symbol) => symbol.description === 'clean')
  if (clean) (store as Record<symbol, () => void>)[clean]()
}
