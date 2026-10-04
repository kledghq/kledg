/**
 * Typed Prisma mock for route and unit tests that do not need PostgreSQL.
 *
 * Every model delegate and method exists on first access as a `vi.fn()`, so a
 * test only configures what its handler calls, without `as any` casts:
 *
 *   vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
 *
 *   import { prisma } from '@/lib/prisma'
 *   import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
 *   const db = asPrismaMock(prisma)
 *
 *   db.account.findMany.mockResolvedValue([{ id: 'acc-1', code: '512000' }])
 *   expect(db.account.findMany).toHaveBeenCalledWith({ where: { companyId: 'company-1' } })
 *
 * Model names, method names and call arguments are typed: a typo
 * (`db.acount`) fails the typecheck and `db.account.findMany.mock.calls[0][0]`
 * is a `findMany` argument. Resolved values are not checked against the
 * Prisma payload on purpose, since tests return partial rows. `$transaction` runs its
 * callback with the mock itself (interactive form) or awaits its array.
 * `vi.clearAllMocks()` keeps that behaviour; after `vi.resetAllMocks()` call
 * `resetPrismaMock(db)`.
 *
 * Tests of triggers, locks and transactions use a real database instead
 * (`test-db.ts`).
 */

import type { PrismaClient } from '@prisma/client'
import { vi, type Mock } from 'vitest'

/** A mocked Prisma method: called with anything, resolves to whatever the test sets. */
export type PrismaMethodMock = Mock<(...args: unknown[]) => Promise<unknown>>

type ModelName = {
  [K in keyof PrismaClient]: K extends `$${string}` ? never : K extends string ? K : never
}[keyof PrismaClient]

/** A model method: typed arguments (calls, implementations), any resolved value (partial rows). */
type ModelMethodMock<F> = F extends (...args: infer A) => unknown ? Mock<(...args: A) => Promise<unknown>> : never

type DelegateMock<D> = {
  [K in keyof D as D[K] extends (...args: never[]) => unknown ? K : never]: ModelMethodMock<D[K]>
}

export type PrismaMock = { [M in ModelName]: DelegateMock<PrismaClient[M]> } & {
  $transaction: PrismaMethodMock
  $queryRaw: PrismaMethodMock
  $queryRawUnsafe: PrismaMethodMock
  $executeRaw: PrismaMethodMock
  $executeRawUnsafe: PrismaMethodMock
}

function transactionImplementation(db: PrismaMock) {
  return async (...args: unknown[]): Promise<unknown> => {
    const [operation] = args
    if (typeof operation === 'function') return operation(db)
    if (Array.isArray(operation)) return Promise.all(operation)
    throw new Error('$transaction mock: expected a callback or an array of queries')
  }
}

/** A fresh Prisma mock: delegates and methods are created on first access. */
export function createPrismaMock(): PrismaMock {
  const delegates = new Map<string, Record<string, PrismaMethodMock>>()
  const roots = new Map<string, PrismaMethodMock>()

  const db = new Proxy({} as PrismaMock, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      // Not a thenable: `await import(...)` and `expect(...).resolves` must not treat the mock as a promise.
      if (property === 'then') return undefined
      if (property.startsWith('$')) {
        let fn = roots.get(property)
        if (!fn) {
          fn = vi.fn<(...args: unknown[]) => Promise<unknown>>()
          if (property === '$transaction') fn.mockImplementation(transactionImplementation(db))
          roots.set(property, fn)
        }
        return fn
      }
      let delegate = delegates.get(property)
      if (!delegate) {
        const methods: Record<string, PrismaMethodMock> = {}
        delegate = new Proxy(methods, {
          get(target, method) {
            if (typeof method !== 'string' || method === 'then') return undefined
            target[method] ??= vi.fn<(...args: unknown[]) => Promise<unknown>>()
            return target[method]
          },
        })
        delegates.set(property, delegate)
      }
      return delegate
    },
  })
  return db
}

/** Restores the default `$transaction` behaviour after `vi.resetAllMocks()`. */
export function resetPrismaMock(db: PrismaMock): void {
  db.$transaction.mockImplementation(transactionImplementation(db))
}

/** The `@/lib/prisma` module with a fresh mock, for `vi.mock('@/lib/prisma', ...)`. */
export function prismaModuleMock(): { prisma: PrismaMock } {
  return { prisma: createPrismaMock() }
}

/** Views the mocked `prisma` import as its mock, to configure and inspect calls. */
export function asPrismaMock(client: PrismaClient | PrismaMock): PrismaMock {
  return client as PrismaMock
}
