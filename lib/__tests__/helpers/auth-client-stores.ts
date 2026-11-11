/**
 * Better Auth keeps the session in nanostores, which unmount a store one
 * second after its last listener leaves (STORE_UNMOUNT_DELAY). In a jsdom test
 * file that ends sooner, that unmount ran after the environment was torn down
 * and Better Auth's cleanup failed the run with "window is not defined".
 * vitest.setup.ts unmounts the auth client's stores after each file instead,
 * with nanostores' own test cleanup (the store's `clean` hook).
 */

import { authClient } from '@/lib/auth-client'

type AuthClientAtom = object & { active?: boolean }

/** The nanostores atoms of the auth client (none when a test mocks the client). */
export function authClientAtoms(): AuthClientAtom[] {
  const store = (authClient as { $store?: { atoms?: Record<string, AuthClientAtom> } } | undefined)?.$store
  return Object.values(store?.atoms ?? {})
}

/** Runs the pending unmount of every auth client store now. */
export function unmountAuthClientStores(): void {
  for (const atom of authClientAtoms()) {
    const clean = Object.getOwnPropertySymbols(atom).find((symbol) => symbol.description === 'clean')
    if (clean) (atom as Record<symbol, () => void>)[clean]()
  }
}
