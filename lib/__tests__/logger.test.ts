/**
 * lib/logger.ts: every level in development, errors only in production.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@/lib/logger'

const levels = ['debug', 'info', 'warn', 'error'] as const

describe('logger', () => {
  beforeEach(() => {
    for (const level of levels) vi.spyOn(console, level).mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('writes every level outside production, with its tag', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const error = new Error('boom')
    logger.debug('a', 1)
    logger.info('b')
    logger.warn('c')
    logger.error('d', error)
    expect(console.debug).toHaveBeenCalledWith('[DEBUG]', 'a', 1)
    expect(console.info).toHaveBeenCalledWith('[INFO]', 'b')
    expect(console.warn).toHaveBeenCalledWith('[WARN]', 'c')
    expect(console.error).toHaveBeenCalledWith('[ERROR]', 'd', error)
  })

  it('keeps only errors in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    for (const level of levels) logger[level]('message')
    expect(console.debug).not.toHaveBeenCalled()
    expect(console.info).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[ERROR]', 'message')
  })
})
