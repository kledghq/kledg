import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// Better Auth keeps the session in nanostores, which unmount a store one
// second after its last listener leaves. In a test file that ends sooner, that
// unmount ran after jsdom was torn down and failed the run with "window is not
// defined": unmount the auth client's stores now (nanostores' test cleanup).
afterAll(async () => {
  const client = await import('@/lib/auth-client').catch(() => null)
  const atoms = (client?.authClient as { $store?: { atoms?: Record<string, object> } } | undefined)?.$store?.atoms
  for (const atom of Object.values(atoms ?? {})) {
    const clean = Object.getOwnPropertySymbols(atom).find((symbol) => symbol.description === 'clean')
    if (clean) (atom as Record<symbol, () => void>)[clean]()
  }
})

// jsdom does not implement Pointer Capture or scrollIntoView; Radix primitives
// call into them. Polyfill so components that use Radix Select/Popover can be
// interacted with in tests.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

// cmdk and some Radix primitives use ResizeObserver. jsdom doesn't ship one.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
