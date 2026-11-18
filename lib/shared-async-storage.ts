/**
 * An AsyncLocalStorage shared by every copy of the module that creates it.
 *
 * The production bundler can evaluate one source module several times (one
 * copy per route graph). Prisma's client lives on globalThis and is created
 * by the first copy, so its pool captures that copy's storage, while a route
 * (MCP) enters a context in its own copy: the pool then reads nothing and
 * RLS falls back to anonymous (issue #98). Keeping the instance on
 * globalThis, under a registered symbol, gives every copy the same storage;
 * each request still has its own context through `storage.run()`.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export function sharedAsyncLocalStorage<T>(name: string): AsyncLocalStorage<T> {
  const key = Symbol.for(`kledg.async-storage.${name}`)
  const registry = globalThis as unknown as Record<symbol, AsyncLocalStorage<T> | undefined>
  return (registry[key] ??= new AsyncLocalStorage<T>())
}
