/**
 * lib/resilient-singleton.ts: the Better Auth instance whose initialization
 * failed (database waking up) is made again instead of failing every
 * request, and the failure is never an unhandled rejection.
 */

import { describe, expect, it, vi } from 'vitest'

import { resilientSingleton } from '../resilient-singleton'

const timeout = () => new Error('Connection terminated due to connection timeout')

describe('resilientSingleton', () => {
  it('creates the instance on first use and reuses it while it works', async () => {
    const create = vi.fn(() => ({ $context: Promise.resolve('ready'), api: { ping: () => 'pong' } }))
    const auth = resilientSingleton(create, (i) => i.$context, vi.fn())
    expect(create).not.toHaveBeenCalled()
    expect(auth.api.ping()).toBe('pong')
    await Promise.resolve()
    expect(auth.api.ping()).toBe('pong')
    expect('api' in auth).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('makes a new instance after a failed initialization, and reports the failure', async () => {
    const onFailure = vi.fn()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    let n = 0
    const create = vi.fn(() => {
      n += 1
      const id = n
      return { id, $context: id === 1 ? Promise.reject(timeout()) : Promise.resolve('ready') }
    })
    const auth = resilientSingleton(create, (i) => i.$context, onFailure)

    expect(auth.id).toBe(1)
    await expect(auth.$context).rejects.toThrow(/connection timeout/)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/connection timeout/) }))
    expect(auth.id).toBe(2)
    await expect(auth.$context).resolves.toBe('ready')
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })
})
