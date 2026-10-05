/**
 * The row level security context of the current request (docs/rls.md).
 *
 * Who acts, held in an AsyncLocalStorage for the duration of a request,
 * a job or a script. The database layer (lib/rls/pool.ts) sends it with
 * every transaction (`kledg.access`, `kledg.user_id`, `kledg.company_scope`)
 * when KLEDG_RLS=enforce; the policies of the migration
 * 20261020090000_row_level_security filter rows with it. With KLEDG_RLS=off
 * the context is still tracked (it costs an AsyncLocalStorage lookup) but
 * never sent.
 *
 * The context of a transaction is the one active when it starts: entering
 * another context inside a `$transaction` callback applies to the next
 * transaction only.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { logger } from '@/lib/logger'

/**
 * Why a job runs without a user. A closed list: every use of the system
 * context is in a place documented in docs/rls.md, and
 * lib/rls/__tests__/system-context-usage.test.ts fails when a file outside
 * that list calls `withSystemContext`.
 */
export type SystemReason =
  /** The daily bank sync (CRON_SECRET), lib/banking/sync-banks.service.ts. */
  | 'cron:bank-sync'
  /** The daily automatic period closing (CRON_SECRET), lib/accounting/period-lock/auto-lock.service.ts. */
  | 'cron:period-lock'
  /**
   * A company created by a user the instance policy allows
   * (companyCreationRefusal): the company and its organization do not exist
   * yet, lib/companies/create-company.service.ts.
   */
  | 'company-creation'
  /**
   * Re-encryption of the credentials sealed with an older auth secret, at
   * server start, lib/crypto/reencrypt.ts.
   */
  | 'secret-rotation'
  /**
   * The update history, at server start: the UPDATES_MERGE audit rows (no
   * company, readable by unrestricted contexts only) that attribute a new
   * version to the administrator who installed it, lib/updates/history.ts.
   */
  | 'version-history'
  /** Command line scripts run by an operator (scripts/). */
  | 'script'
  /** Instance extensions of a fork (docs/extension-points.md), e.g. the demo's throwaway companies. */
  | 'instance-extension'
  /** Data that tests write or read directly, outside a request (lib/__tests__/helpers/test-db.ts). */
  | 'test'

export type RlsContext =
  | {
      access: 'user'
      userId: string
      /** Narrows the user's companies (an AI assistant's grant); never widens them. */
      companyIds?: readonly string[]
    }
  | {
      access: 'system'
      reason: SystemReason
      /** The companies of the job; every company when absent. */
      companyIds?: readonly string[]
    }
  | { access: 'anonymous' }

/** A request without a session (sign-in, password reset, setup): no company is reachable. */
export const ANONYMOUS_CONTEXT: RlsContext = Object.freeze({ access: 'anonymous' })

const storage = new AsyncLocalStorage<RlsContext>()

/** The context of the current async execution, or undefined outside any. */
export function currentRlsContext(): RlsContext | undefined {
  return storage.getStore()
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function'
}

/**
 * Runs `fn` (and everything it awaits or schedules) in `context`.
 *
 * Prisma's promises are lazy: a query starts when the promise is awaited,
 * not when it is created. A thenable returned by `fn` is therefore started
 * here, inside the context; awaiting it later, outside, would run the query
 * without it.
 */
export function runWithRlsContext<T>(context: RlsContext, fn: () => T): T {
  return storage.run(context, () => {
    const result = fn()
    if (!isThenable(result)) return result
    return new Promise((resolve, reject) => result.then(resolve, reject)) as T
  })
}

/** Runs `fn` as `userId`, optionally narrowed to `companyIds` (an AI assistant's grant). */
export function withUserContext<T>(userId: string, fn: () => T, options: { companyIds?: readonly string[] } = {}): T {
  if (!userId) throw new Error('withUserContext needs a user id')
  const context: RlsContext = options.companyIds
    ? { access: 'user', userId, companyIds: [...options.companyIds] }
    : { access: 'user', userId }
  return runWithRlsContext(context, fn)
}

/**
 * Runs `fn` as a server job without a user: every company, or only
 * `companyIds`. Logged with its reason. Reserved to the places listed in
 * docs/rls.md; a request acting for a user never uses it.
 */
export function withSystemContext<T>(reason: SystemReason, fn: () => T, options: { companyIds?: readonly string[] } = {}): T {
  const context: RlsContext = options.companyIds
    ? { access: 'system', reason, companyIds: [...options.companyIds] }
    : { access: 'system', reason }
  if (reason !== 'test') {
    logger.info(`RLS system context (${reason})${options.companyIds ? `, companies ${options.companyIds.join(', ')}` : ''}`)
  }
  return runWithRlsContext(context, fn)
}

/** Runs `fn` without a session: no company is reachable (Better Auth tables only). */
export function withAnonymousContext<T>(fn: () => T): T {
  return runWithRlsContext(ANONYMOUS_CONTEXT, fn)
}
