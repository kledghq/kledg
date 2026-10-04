import { describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { attachPoolToPlatform, databaseUrl, poolSizing, sslConfig } from '../prisma'

describe('poolSizing', () => {
  it('keeps idle connections 5 s on Vercel and 30 s on a long running server', () => {
    expect(poolSizing({ VERCEL: '1' })).toEqual({ max: 10, idleTimeoutMillis: 5_000 })
    expect(poolSizing({})).toEqual({ max: 10, idleTimeoutMillis: 30_000 })
  })

  it('reads positive integer overrides and ignores invalid ones', () => {
    expect(poolSizing({ DATABASE_POOL_MAX: '4', DATABASE_POOL_IDLE_TIMEOUT_MS: '1000' })).toEqual({
      max: 4,
      idleTimeoutMillis: 1000,
    })
    expect(poolSizing({ DATABASE_POOL_MAX: '0', DATABASE_POOL_IDLE_TIMEOUT_MS: 'abc' })).toEqual({
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  })
})

describe('attachPoolToPlatform', () => {
  const pool = new Pool({ connectionString: 'postgresql://kledg:kledg@localhost:1/none', idleTimeoutMillis: 5_000 })

  it('lets Vercel wait for idle clients to close before suspending the instance', () => {
    const attach = vi.fn()
    expect(attachPoolToPlatform(pool, { VERCEL: '1' }, attach)).toBe(true)
    expect(attach).toHaveBeenCalledWith(pool)
  })

  it('attaches nothing outside Vercel', () => {
    const attach = vi.fn()
    expect(attachPoolToPlatform(pool, {}, attach)).toBe(false)
    expect(attach).not.toHaveBeenCalled()
  })

  it('uses the real attachDatabasePool by default, which only registers a release listener', () => {
    const fresh = new Pool({ connectionString: 'postgresql://kledg:kledg@localhost:1/none', idleTimeoutMillis: 5_000 })
    expect(attachPoolToPlatform(fresh, { VERCEL: '1' })).toBe(true)
    expect(fresh.listenerCount('release')).toBe(1)
  })
})

describe('databaseUrl', () => {
  it('reads DATABASE_URL, then the fallbacks of other integrations', () => {
    expect(databaseUrl({ DATABASE_URL: 'postgresql://a', POSTGRESQL_ADDON_URI: 'postgresql://b' })).toBe('postgresql://a')
    expect(databaseUrl({ POSTGRES_URL: 'postgresql://neon' })).toBe('postgresql://neon')
    // Clever Cloud PostgreSQL add-on, linked to the application.
    expect(databaseUrl({ POSTGRESQL_ADDON_URI: 'postgresql://clever' })).toBe('postgresql://clever')
    expect(databaseUrl({ DATABASE_URL: '' })).toBeUndefined()
  })
})

describe('sslConfig', () => {
  const tls = { rejectUnauthorized: false }

  it('uses TLS for databases on the public network', () => {
    for (const host of ['ep-cool-1.eu-central-1.aws.neon.tech', 'dpg-abc123-a.frankfurt-postgres.render.com', 'bxyz-postgresql.services.clever-cloud.com']) {
      expect(sslConfig(`postgresql://u:p@${host}:5432/db`, {}), host).toEqual(tls)
    }
  })

  it('skips TLS on local hosts, Docker service names and private networks', () => {
    for (const host of ['localhost', 'db', 'postgres', 'kledg-db', 'dpg-abc123-a', 'postgres.railway.internal', 'kledg-db.flycast']) {
      expect(sslConfig(`postgresql://u:p@${host}:5432/db`, {}), host).toBe(false)
    }
  })

  it("skips TLS on Fly's .internal names only when running on Fly", () => {
    expect(sslConfig('postgresql://u:p@kledg-db.internal:5432/db', { FLY_APP_NAME: 'kledg' })).toBe(false)
    // Elsewhere .internal is any private DNS zone, not known to be encrypted.
    expect(sslConfig('postgresql://u:p@db.corp.internal:5432/db', {})).toEqual(tls)
  })

  it('follows sslmode and DATABASE_SSL over the host name', () => {
    expect(sslConfig('postgresql://u:p@db.example.com:5432/db?sslmode=disable', {})).toBe(false)
    expect(sslConfig('postgresql://u:p@db.example.com:5432/db', { DATABASE_SSL: 'false' })).toBe(false)
    expect(sslConfig('postgresql://u:p@dpg-abc123-a:5432/db?sslmode=require', {})).toEqual(tls)
    expect(sslConfig('postgresql://u:p@kledg-db.flycast:5432/db', { DATABASE_SSL: 'true' })).toEqual(tls)
  })
})
