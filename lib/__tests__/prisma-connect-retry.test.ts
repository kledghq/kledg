import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { isTransientConnectError, retryConnectOnce } from '../prisma'

/** A pool whose connect() fails with the given errors, then succeeds. */
function fakePool(failures: Error[]) {
  const release = vi.fn()
  const client = { release }
  const connect = vi.fn((callback?: (err?: Error, client?: unknown) => void) => {
    const failure = failures.shift()
    if (callback) {
      queueMicrotask(() => (failure ? callback(failure) : callback(undefined, client)))
      return undefined
    }
    return failure ? Promise.reject(failure) : Promise.resolve(client)
  })
  const pool = { connect } as unknown as Pool
  retryConnectOnce(pool)
  return { pool, connect, client, release }
}

const timeout = () => new Error('Connection terminated due to connection timeout')

describe('Postgres connect retry (scale-to-zero databases)', () => {
  it('recognises connection errors that never reached the database', () => {
    expect(isTransientConnectError(timeout())).toBe(true)
    expect(isTransientConnectError(new Error('Connection terminated unexpectedly'))).toBe(true)
    expect(isTransientConnectError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true)
    expect(isTransientConnectError(new Error('password authentication failed'))).toBe(false)
  })

  it('retries a timed-out connection once (promise form)', async () => {
    const { pool, connect, client } = fakePool([timeout()])
    await expect(pool.connect()).resolves.toBe(client)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('gives up after the second failure', async () => {
    const { pool, connect } = fakePool([timeout(), timeout()])
    await expect(pool.connect()).rejects.toThrow(/connection timeout/)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('does not retry other errors', async () => {
    const { pool, connect } = fakePool([new Error('password authentication failed')])
    await expect(pool.connect()).rejects.toThrow(/password/)
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('retries in the callback form used by pool.query, and passes a working release', async () => {
    const { pool, connect, client, release } = fakePool([timeout()])
    const result = await new Promise<{ err?: Error; c?: unknown; done?: (e?: Error) => void }>((resolve) =>
      (pool.connect as unknown as (cb: (err?: Error, c?: unknown, done?: (e?: Error) => void) => void) => void)(
        (err, c, done) => resolve({ err, c, done }),
      ),
    )
    expect(result.err).toBeUndefined()
    expect(result.c).toBe(client)
    result.done?.()
    expect(release).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
