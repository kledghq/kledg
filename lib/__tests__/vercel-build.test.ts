/**
 * Vercel build (scripts/vercel-build.mjs): migrations run whenever a database
 * URL exists, and always in production (which fails loudly without one); a
 * preview without any database, like the pull request of an update, only
 * builds instead of failing on "Connection url is empty".
 */

import { describe, expect, it } from 'vitest'
import { shouldMigrate as migrate } from '../../scripts/vercel-build.mjs'

describe('vercel-build', () => {
  it('skips the migrations of a preview without a database', () => {
    expect(migrate({ VERCEL_ENV: 'preview' })).toBe(false)
    expect(migrate({ VERCEL_ENV: 'preview', DATABASE_URL: '  ' })).toBe(false)
  })

  it('migrates a preview that has its own database (Neon branch)', () => {
    expect(migrate({ VERCEL_ENV: 'preview', DATABASE_URL_UNPOOLED: 'postgres://branch' })).toBe(true)
    expect(migrate({ VERCEL_ENV: 'preview', POSTGRES_URL: 'postgres://branch' })).toBe(true)
  })

  it('always migrates production, so a missing database fails the deployment', () => {
    expect(migrate({ VERCEL_ENV: 'production' })).toBe(true)
    expect(migrate({ VERCEL_ENV: 'production', DATABASE_URL: 'postgres://prod' })).toBe(true)
  })
})
