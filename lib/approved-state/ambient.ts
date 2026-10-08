/**
 * One transaction for a whole approved MCP action (finding KLEDG-R3-MCP-01).
 *
 * Most high-impact tools call services that write in several steps, some
 * of them outside any transaction (an import, a closing, a settings change).
 * To check the approved state inside the transaction that writes, for every
 * such tool, the execution of an approved action runs inside a single
 * PostgreSQL transaction (`runInAmbientTransaction`): it starts by locking
 * and checking the approved targets (lib/approved-state/guard.ts), then the
 * service runs, and every query it makes through `prisma` (lib/prisma.ts
 * asks `ambientProperty`) goes to that transaction:
 * - a query outside a `$transaction` of the service runs in its own
 *   savepoint, so a database error the service catches (a duplicate it
 *   skips) does not abort the whole transaction, as it would not have
 *   outside;
 * - a `$transaction(fn)` of the service becomes a savepoint: `fn` receives
 *   the ambient transaction, and its failure rolls back to the savepoint;
 *   the array form awaits its queries in order;
 * - savepoints are taken one at a time (queries of a Promise.all wait for
 *   each other), so they never interleave.
 * The rows locked at the start stay locked until the action ends: an edit
 * of an approved row waits, and is never half seen. If anything throws, the
 * whole action rolls back. The services are unchanged.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Prisma, PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'

type Tx = Prisma.TransactionClient

interface Ambient {
  tx: Tx
  /** Serializes the savepoints of top-level queries and service transactions. */
  queue: Promise<unknown>
  /** Side effects outside the database (an email), run once the transaction committed. */
  afterCommit: Array<() => Promise<void>>
}

const storage = new AsyncLocalStorage<{ ambient: Ambient; nested: boolean }>()

/** Long enough for the bank calls an approved import or sync makes (20 s each, lib/banking/http.ts). */
const AMBIENT_TX_OPTIONS = { maxWait: 30_000, timeout: 300_000 } as const

/** Runs `task` after the previous savepoint of the ambient transaction finished. */
function serialized<T>(ambient: Ambient, task: () => Promise<T>): Promise<T> {
  const run = ambient.queue.then(task, task)
  ambient.queue = run.catch(() => undefined)
  return run
}

/**
 * `op` inside its own savepoint: a failure rolls back to it and leaves the
 * ambient transaction usable. Savepoints are taken one at a time (serialized),
 * so one name serves them all (a literal: no SQL is built from strings).
 */
function inSavepoint<T>(ambient: Ambient, op: () => Promise<T>): Promise<T> {
  return serialized(ambient, async () => {
    await ambient.tx.$executeRaw`SAVEPOINT kledg_sp`
    try {
      const result = await op()
      await ambient.tx.$executeRaw`RELEASE SAVEPOINT kledg_sp`
      return result
    } catch (error) {
      await ambient.tx.$executeRaw`ROLLBACK TO SAVEPOINT kledg_sp`
      await ambient.tx.$executeRaw`RELEASE SAVEPOINT kledg_sp`
      throw error
    }
  })
}

function transactionOf(ambient: Ambient, nested: boolean) {
  return (arg: unknown) => {
    if (Array.isArray(arg)) {
      // The queries were built through the ambient client: await them in order.
      return (async () => {
        const results: unknown[] = []
        for (const query of arg) results.push(await query)
        return results
      })()
    }
    const fn = arg as (tx: Tx) => Promise<unknown>
    if (nested) return fn(ambient.tx)
    return inSavepoint(ambient, () => storage.run({ ambient, nested: true }, () => fn(ambient.tx)))
  }
}

/**
 * What `prisma.<property>` is inside an ambient transaction, or undefined
 * outside one (and for the client's own methods: $connect, $disconnect...).
 */
export function ambientProperty(property: string | symbol): unknown {
  const store = storage.getStore()
  if (!store) return undefined
  const { ambient, nested } = store
  if (property === '$transaction') return transactionOf(ambient, nested)
  if (typeof property !== 'string' || property === 'then' || property === '$connect' || property === '$disconnect' || property === '$on' || property === '$extends') {
    return undefined
  }
  const value = (ambient.tx as unknown as Record<string, unknown>)[property]
  if (value === undefined || value === null) return undefined
  if (nested) return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(ambient.tx) : value
  if (typeof value === 'function') {
    // $queryRaw, $executeRaw and the other raw forms: one savepoint per query
    return (...args: unknown[]) => inSavepoint(ambient, () => (value as (...a: unknown[]) => Promise<unknown>).apply(ambient.tx, args))
  }
  // A model delegate: each operation in its own savepoint
  return new Proxy(value as object, {
    get(delegate, method) {
      const operation = (delegate as Record<string | symbol, unknown>)[method]
      if (typeof operation !== 'function') return operation
      return (...args: unknown[]) => inSavepoint(ambient, () => (operation as (...a: unknown[]) => Promise<unknown>).apply(delegate, args))
    },
  })
}

/** Whether the code runs inside an ambient transaction. */
export function inAmbientTransaction(): boolean {
  return storage.getStore() !== undefined
}

/**
 * Runs `task` once the work it belongs to is durable: right away outside an
 * ambient transaction, after the commit inside one (never if it rolls back),
 * so an email never announces a row that a later failure undoes. A deferred
 * task that fails is logged: the action itself already succeeded.
 */
export async function runAfterCommit(task: () => Promise<void>): Promise<void> {
  const store = storage.getStore()
  if (!store) return task()
  store.ambient.afterCommit.push(task)
}

/**
 * Runs `fn` in one transaction of `client` (the base client, not the
 * proxy): `before(tx)` first (lock and check the approved targets), then
 * `fn`, every query of which goes to the same transaction.
 */
export async function runInAmbientTransaction<T>(client: PrismaClient, before: (tx: Tx) => Promise<void>, fn: () => Promise<T>): Promise<T> {
  const afterCommit: Array<() => Promise<void>> = []
  const result = await client.$transaction(async (tx) => {
    await before(tx)
    const ambient: Ambient = { tx, queue: Promise.resolve(), afterCommit }
    return storage.run({ ambient, nested: false }, async () => {
      const result = await fn()
      // Queries started and not awaited by the service finish before the commit.
      await ambient.queue
      return result
    })
  }, AMBIENT_TX_OPTIONS)
  for (const task of afterCommit) {
    await task().catch((error: unknown) => logger.error('Tâche après validation de l\'action approuvée en échec', { error }))
  }
  return result
}
