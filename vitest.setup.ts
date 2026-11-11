import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// Unmount Better Auth's session store before jsdom is torn down
// (lib/__tests__/helpers/auth-client-stores.ts).
afterAll(async () => {
  const helper = await import('@/lib/__tests__/helpers/auth-client-stores').catch(() => null)
  try {
    helper?.unmountAuthClientStores()
  } catch {
    // A test that mocks the auth client has no store to unmount
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
