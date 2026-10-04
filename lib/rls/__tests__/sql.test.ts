import { describe, expect, it } from 'vitest'
import {
  beginWithContextSql,
  contextSettings,
  isWriteStatement,
  isolationLevelOf,
  setContextSql,
  textArrayLiteral,
  transactionControlOf,
} from '../sql'
import { RlsConfigurationError, rlsMode } from '../mode'
import { touchesOnlyExemptTables } from '../tables'

const escape = (value: string) => `'${value.replace(/'/g, "''")}'`

describe('KLEDG_RLS', () => {
  it('is off by default and accepts off or enforce only', () => {
    expect(rlsMode({})).toBe('off')
    expect(rlsMode({ KLEDG_RLS: '' })).toBe('off')
    expect(rlsMode({ KLEDG_RLS: 'off' })).toBe('off')
    expect(rlsMode({ KLEDG_RLS: ' Enforce ' })).toBe('enforce')
    expect(() => rlsMode({ KLEDG_RLS: 'enforced' })).toThrow(RlsConfigurationError)
    expect(() => rlsMode({ KLEDG_RLS: 'on' })).toThrow('KLEDG_RLS must be "off" or "enforce", got "on"')
  })
})

describe('context settings', () => {
  it('sets every key, empty when unused, so no value of an earlier transaction remains', () => {
    expect(contextSettings(undefined)).toEqual({ 'kledg.access': '', 'kledg.user_id': '', 'kledg.company_scope': '', 'kledg.reason': '' })
    expect(contextSettings({ access: 'anonymous' })).toEqual({
      'kledg.access': 'anonymous',
      'kledg.user_id': '',
      'kledg.company_scope': '',
      'kledg.reason': '',
    })
    expect(contextSettings({ access: 'user', userId: 'u1' })).toEqual({
      'kledg.access': 'user',
      'kledg.user_id': 'u1',
      'kledg.company_scope': '',
      'kledg.reason': '',
    })
    expect(contextSettings({ access: 'system', reason: 'cron:bank-sync', companyIds: ['c1'] })).toEqual({
      'kledg.access': 'system',
      'kledg.user_id': '',
      'kledg.company_scope': '{"c1"}',
      'kledg.reason': 'cron:bank-sync',
    })
  })

  it('writes an empty scope as an empty array (no company), not as no narrowing', () => {
    expect(contextSettings({ access: 'user', userId: 'u1', companyIds: [] })['kledg.company_scope']).toBe('{}')
  })

  it('quotes array elements so an id cannot add elements or break the literal', () => {
    expect(textArrayLiteral(['a', 'b,c', 'd"e', 'f\\g', '{h}'])).toBe('{"a","b,c","d\\"e","f\\\\g","{h}"}')
  })

  it('uses transaction scoped set_config, escaping every value', () => {
    const sql = setContextSql({ access: 'user', userId: "o'brien" }, escape)
    expect(sql).toBe(
      "SELECT set_config('kledg.access', 'user', true), set_config('kledg.user_id', 'o''brien', true), " +
        "set_config('kledg.company_scope', '', true), set_config('kledg.reason', '', true)",
    )
    expect(sql).not.toContain(', false)')
  })

  it('sends BEGIN and the context in one statement, with the isolation level when asked', () => {
    expect(beginWithContextSql({ access: 'anonymous' }, escape)).toMatch(/^BEGIN; SELECT set_config\('kledg.access', 'anonymous', true\)/)
    expect(beginWithContextSql(undefined, escape, 'SERIALIZABLE')).toMatch(/^BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT/)
  })
})

describe('statement classification', () => {
  it('recognizes writes, including inside a CTE', () => {
    expect(isWriteStatement('INSERT INTO "public"."journals" ("id") VALUES ($1) RETURNING "id"')).toBe(true)
    expect(isWriteStatement('  update "accounts" set "label" = $1')).toBe(true)
    expect(isWriteStatement('DELETE FROM "public"."journals" WHERE "id" = $1')).toBe(true)
    expect(isWriteStatement('WITH moved AS (UPDATE "accounts" SET "label" = $1 RETURNING 1) SELECT count(*) FROM moved')).toBe(true)
    expect(isWriteStatement('SELECT "t0"."id" FROM "public"."journals" AS "t0"')).toBe(false)
    expect(isWriteStatement('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(false)
  })

  it('recognizes the transaction control statements of the Prisma adapter', () => {
    expect(transactionControlOf('BEGIN')).toBe('begin')
    expect(transactionControlOf('COMMIT')).toBe('commit')
    expect(transactionControlOf('ROLLBACK')).toBe('rollback')
    expect(transactionControlOf('ROLLBACK TO SAVEPOINT s1')).toBeUndefined()
    expect(transactionControlOf('SELECT 1')).toBeUndefined()
  })

  it('reads the isolation level of SET TRANSACTION', () => {
    expect(isolationLevelOf('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')).toBe('SERIALIZABLE')
    expect(isolationLevelOf('SET TRANSACTION ISOLATION LEVEL READ  COMMITTED')).toBe('READ COMMITTED')
    expect(isolationLevelOf('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; DROP TABLE x')).toBeUndefined()
    expect(isolationLevelOf('SELECT 1')).toBeUndefined()
  })

  it('lets statements on exempt tables only run without a context, and nothing else', () => {
    expect(touchesOnlyExemptTables('SELECT "t0"."id" FROM "public"."session" AS "t0" WHERE "t0"."token" = $1')).toBe(true)
    expect(
      touchesOnlyExemptTables(
        'SELECT "t1"."userId" FROM "public"."session" AS "t1" LEFT JOIN LATERAL (SELECT "t2"."role" FROM "public"."user" AS "t2") AS "j" ON true',
      ),
    ).toBe(true)
    expect(touchesOnlyExemptTables('INSERT INTO "rateLimit" ("id") VALUES ($1) ON CONFLICT ("key") DO UPDATE SET "count" = 1')).toBe(true)
    expect(touchesOnlyExemptTables('SELECT 1')).toBe(true)
    expect(touchesOnlyExemptTables('SELECT "t0"."id" FROM "public"."companies" AS "t0"')).toBe(false)
    expect(touchesOnlyExemptTables('SELECT * FROM "public"."session" s JOIN "public"."member" m ON m."userId" = s."userId"')).toBe(false)
    expect(touchesOnlyExemptTables('SELECT * FROM companies')).toBe(false)
    expect(touchesOnlyExemptTables('SELECT * FROM "public"."_prisma_migrations"')).toBe(false)
  })
})
