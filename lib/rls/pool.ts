/**
 * Applies the row level security context to every PostgreSQL statement
 * (docs/rls.md), at the node-postgres pool that Prisma's adapter uses: Prisma
 * model calls, $queryRaw/$executeRaw, transactions and Better Auth all go
 * through it.
 *
 * Neon's pooled URL is PgBouncer in transaction mode, where only settings
 * local to a transaction are safe. So with KLEDG_RLS=enforce every statement
 * runs in a transaction that starts by setting the context:
 * - a statement outside a transaction (`pool.query`) becomes
 *   `BEGIN; SELECT set_config(...)`, the statement, `COMMIT`;
 * - a transaction (`pool.connect`, then BEGIN from Prisma's adapter) holds
 *   its BEGIN back and sends it with the context in front of its first
 *   statement, in the same round trip as before (a first
 *   `SET TRANSACTION ISOLATION LEVEL` becomes `BEGIN ISOLATION LEVEL`).
 *
 * The context is read when the statement or the connection is requested, in
 * the caller's async context: never later, from a pool callback that may run
 * in another request's context.
 *
 * Without any context (no request, no withSystemContext) a statement runs
 * with empty settings: the policies return no row, and writes are refused
 * here before they are sent.
 */

import type { Pool, PoolClient, QueryResult } from 'pg'
import type { RlsContext } from './context'
import { RlsConfigurationError } from './mode'
import {
  beginWithContextSql,
  isWriteStatement,
  isolationLevelOf,
  transactionControlOf,
} from './sql'
import { touchesOnlyExemptTables } from './tables'

export class RlsContextMissingError extends Error {
  constructor(sql: string) {
    super(`Refused a write without a row level security context (KLEDG_RLS=enforce): ${sql.replace(/\s+/g, ' ').slice(0, 120)}`)
    this.name = 'RlsContextMissingError'
  }
}

export interface RlsPoolOptions {
  /** The explicit context of the caller (AsyncLocalStorage), read synchronously. */
  capture: () => RlsContext | undefined
  /** A context when the caller has none: the session of a Next request, or undefined. */
  derive: () => Promise<RlsContext | undefined>
  /** Checks once, before the first statement, that the role is subject to the policies. */
  verify?: (query: (sql: string) => Promise<QueryResult>) => Promise<void>
}

type QueryArgs = [config: unknown, values?: unknown, callback?: unknown]
type ClientQuery = (...args: QueryArgs) => unknown

/** Per checkout state of a client: what the next statements of its transaction need. */
type TransactionState =
  /** Connected for a transaction: BEGIN not seen yet. */
  | { phase: 'armed'; context: RlsContext | undefined }
  /** BEGIN received and held back, to be sent with the first statement. */
  | { phase: 'deferred'; context: RlsContext | undefined }
  /** BEGIN and the context sent. */
  | { phase: 'open'; context: RlsContext | undefined }

const STATE = Symbol('kledg.rls.transaction')
const PATCHED = Symbol('kledg.rls.patched')

type TrackedClient = PoolClient & { [STATE]?: TransactionState; [PATCHED]?: ClientQuery }

function sqlOf(config: unknown): string {
  if (typeof config === 'string') return config
  if (config && typeof config === 'object' && typeof (config as { text?: unknown }).text === 'string') {
    return (config as { text: string }).text
  }
  return ''
}

function emptyResult(command: string): QueryResult {
  return { command, rowCount: null, oid: 0, rows: [], fields: [] }
}

/** Calls `callback` (node-postgres' callback form) or returns the promise. */
function settle<T>(promise: Promise<T>, callback: unknown): Promise<T> | undefined {
  if (typeof callback !== 'function') return promise
  promise.then(
    (result) => (callback as (err: unknown, result?: T) => void)(null, result),
    (error) => (callback as (err: unknown) => void)(error),
  )
  return undefined
}

function splitArgs(args: QueryArgs): { config: unknown; values: unknown; callback: unknown } {
  const [config, values, callback] = args
  if (typeof values === 'function') return { config, values: undefined, callback: values }
  return { config, values, callback }
}

/**
 * Patches `pool` in place (its class stays pg.Pool, which Prisma's adapter
 * checks). Call after any other patch of `pool.connect` (connection retry).
 */
export function enforceRlsOnPool(pool: Pool, options: RlsPoolOptions): void {
  const rawConnect = pool.connect.bind(pool) as () => Promise<PoolClient>
  let verified: Promise<void> | undefined

  function verifyOnce(client: PoolClient): Promise<void> {
    if (!options.verify) return Promise.resolve()
    verified ??= options.verify((sql) => client.query(sql)).catch((error: unknown) => {
      // A configuration error stays (every statement is refused); a failure
      // to reach the database is checked again by the next statement.
      if (!(error instanceof RlsConfigurationError)) verified = undefined
      throw error
    })
    return verified
  }

  async function checkout(): Promise<TrackedClient> {
    const client = (await rawConnect()) as TrackedClient
    patchClient(client)
    client[STATE] = undefined
    try {
      await verifyOnce(client)
    } catch (error) {
      client.release()
      throw error
    }
    return client
  }

  function patchClient(client: TrackedClient) {
    if (client[PATCHED]) return
    const original = client.query.bind(client) as ClientQuery
    client[PATCHED] = original
    client.query = ((...args: QueryArgs) => {
      const state = client[STATE]
      if (!state) return original(...args)
      const { config, values, callback } = splitArgs(args)
      return settle(runInTransaction(client, original, state, config, values), callback)
    }) as PoolClient['query']
  }

  async function runInTransaction(
    client: TrackedClient,
    original: ClientQuery,
    state: TransactionState,
    config: unknown,
    values: unknown,
  ): Promise<QueryResult> {
    const sql = sqlOf(config)
    const control = transactionControlOf(sql)
    const send = () => (values === undefined ? original(config) : original(config, values)) as Promise<QueryResult>

    if (state.phase === 'armed') {
      if (control === 'begin') {
        client[STATE] = { phase: 'deferred', context: state.context }
        return emptyResult('BEGIN')
      }
      // Not a transaction after all: a statement with the context, on its own.
      client[STATE] = undefined
      return runAutocommit(client, original, state.context, config, values)
    }

    if (state.phase === 'deferred') {
      if (control === 'commit' || control === 'rollback') {
        // Nothing was sent: an empty transaction.
        client[STATE] = undefined
        return emptyResult(control === 'commit' ? 'COMMIT' : 'ROLLBACK')
      }
      const escape = (value: string) => client.escapeLiteral(value)
      const isolation = isolationLevelOf(sql)
      client[STATE] = { phase: 'open', context: state.context }
      if (isolation) {
        await original(beginWithContextSql(state.context, escape, isolation))
        return emptyResult('SET')
      }
      if (!state.context && isWriteStatement(sql)) {
        client[STATE] = undefined
        throw new RlsContextMissingError(sql)
      }
      await original(beginWithContextSql(state.context, escape))
      return send()
    }

    // Open transaction.
    if (control === 'commit' || control === 'rollback') {
      client[STATE] = undefined
      return send()
    }
    if (!state.context && isWriteStatement(sql)) throw new RlsContextMissingError(sql)
    return send()
  }

  async function runAutocommit(
    client: PoolClient,
    original: ClientQuery,
    context: RlsContext | undefined,
    config: unknown,
    values: unknown,
  ): Promise<QueryResult> {
    await original(beginWithContextSql(context, (value) => client.escapeLiteral(value)))
    try {
      const result = (await (values === undefined ? original(config) : original(config, values))) as QueryResult
      await original('COMMIT')
      return result
    } catch (error) {
      await (original('ROLLBACK') as Promise<unknown>).catch(() => undefined)
      throw error
    }
  }

  pool.query = ((...args: QueryArgs) => {
    const { config, values, callback } = splitArgs(args)
    const explicit = options.capture()
    const sql = sqlOf(config)
    const run = async () => {
      if (!sql) throw new Error('Unsupported query form with KLEDG_RLS=enforce')
      // Statements on exempt tables only (Better Auth, rate limits: the
      // session lookup of every request) have no policy to apply: they run
      // as they are, without deriving a context (which would read the
      // session again). Writes still need a context.
      const exemptOnly = touchesOnlyExemptTables(sql)
      const write = isWriteStatement(sql)
      const context = explicit ?? (!exemptOnly || write ? await options.derive() : undefined)
      if (!context && write) throw new RlsContextMissingError(sql)
      const client = await checkout()
      const original = client[PATCHED] as ClientQuery
      let broken: unknown
      try {
        if (exemptOnly) return (await (values === undefined ? original(config) : original(config, values))) as QueryResult
        return await runAutocommit(client, original, context, config, values)
      } catch (error) {
        broken = isConnectionError(error) ? error : undefined
        throw error
      } finally {
        client.release(broken as Error | undefined)
      }
    }
    return settle(run(), callback)
  }) as Pool['query']

  pool.connect = ((callback?: unknown) => {
    const explicit = options.capture()
    const run = async () => {
      // The adapter connects to start a transaction: its context is the caller's now.
      const context = explicit ?? (await options.derive())
      const client = await checkout()
      client[STATE] = { phase: 'armed', context }
      return client
    }
    if (typeof callback === 'function') {
      run().then(
        (client) => (callback as (err: unknown, client?: PoolClient, release?: () => void) => void)(undefined, client, () => client.release()),
        (error) => (callback as (err: unknown) => void)(error),
      )
      return undefined
    }
    return run()
  }) as Pool['connect']
}

/** Errors after which a client must not go back to the pool. */
function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^(ECONN|EPIPE|ETIMEDOUT|57P0|08)/.test(code)
}
