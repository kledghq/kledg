/**
 * Names of the test databases (lib/__tests__/helpers/test-db.ts): the
 * KLEDG_TEST_DB_PREFIX of a run keeps parallel runs (CI jobs, agents, second
 * checkouts) on separate databases, and the default keeps today's names.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEST_DB_PREFIX,
  testDatabaseAvailable,
  testDatabaseName,
  testDatabasePrefix,
  testDatabaseRequired,
  testDatabaseUrl,
} from './helpers/test-db'

describe('test database names', () => {
  it('keeps kledg_test_<name> without a prefix', () => {
    expect(DEFAULT_TEST_DB_PREFIX).toBe('kledg_test')
    expect(testDatabaseName('closing', {})).toBe('kledg_test_closing')
    expect(testDatabaseName('closing', { KLEDG_TEST_DB_PREFIX: '' })).toBe('kledg_test_closing')
    expect(testDatabaseName('closing', { KLEDG_TEST_DB_PREFIX: '  ' })).toBe('kledg_test_closing')
  })

  it('uses KLEDG_TEST_DB_PREFIX when set', () => {
    expect(testDatabasePrefix({ KLEDG_TEST_DB_PREFIX: 'kledg_ci_42' })).toBe('kledg_ci_42')
    expect(testDatabaseName('matrix', { KLEDG_TEST_DB_PREFIX: 'kledg_ci_42' })).toBe('kledg_ci_42_matrix')
  })

  it('gives two prefixes two databases for the same test file', () => {
    const a = testDatabaseName('reconcile', { KLEDG_TEST_DB_PREFIX: 'kledg_a' })
    const b = testDatabaseName('reconcile', { KLEDG_TEST_DB_PREFIX: 'kledg_b' })
    expect(a).not.toBe(b)
  })

  it('refuses a prefix or a name that is not a plain identifier', () => {
    expect(() => testDatabasePrefix({ KLEDG_TEST_DB_PREFIX: 'Kledg' })).toThrow(/KLEDG_TEST_DB_PREFIX/)
    expect(() => testDatabasePrefix({ KLEDG_TEST_DB_PREFIX: 'kledg-ci' })).toThrow(/KLEDG_TEST_DB_PREFIX/)
    expect(() => testDatabasePrefix({ KLEDG_TEST_DB_PREFIX: '1kledg' })).toThrow(/KLEDG_TEST_DB_PREFIX/)
    expect(() => testDatabasePrefix({ KLEDG_TEST_DB_PREFIX: 'a"; DROP DATABASE x; --' })).toThrow()
    expect(() => testDatabaseName('Closing', {})).toThrow(/Invalid test database name/)
    expect(() => testDatabaseName('', {})).toThrow(/Invalid test database name/)
  })

  it('refuses names PostgreSQL would truncate (63 bytes)', () => {
    const prefix = 'k'.repeat(50)
    expect(() => testDatabaseName('aggregate_differential', { KLEDG_TEST_DB_PREFIX: prefix })).toThrow(/too long/)
    expect(testDatabaseName('a', { KLEDG_TEST_DB_PREFIX: 'k'.repeat(61) })).toHaveLength(63)
  })

  it('builds the URL from KLEDG_TEST_DATABASE_URL with the prefixed database', () => {
    const env = { KLEDG_TEST_DATABASE_URL: 'postgresql://u:p@db.local:5433/whatever', KLEDG_TEST_DB_PREFIX: 'kledg_job_7' }
    expect(testDatabaseUrl('setup', env)).toBe('postgresql://u:p@db.local:5433/kledg_job_7_setup')
    expect(testDatabaseUrl('setup', {})).toBe('postgresql://kledg:kledg@localhost:55432/kledg_test_setup')
  })
})

describe('required test database (KLEDG_REQUIRE_TEST_DB)', () => {
  // Port 9 (discard) on localhost: nothing answers PostgreSQL there.
  const unreachable = 'postgresql://kledg:kledg@127.0.0.1:9/kledg_test'

  it('is required only when the flag is true', () => {
    expect(testDatabaseRequired({})).toBe(false)
    expect(testDatabaseRequired({ KLEDG_REQUIRE_TEST_DB: 'false' })).toBe(false)
    expect(testDatabaseRequired({ KLEDG_REQUIRE_TEST_DB: '1' })).toBe(true)
    expect(testDatabaseRequired({ KLEDG_REQUIRE_TEST_DB: 'true' })).toBe(true)
    expect(testDatabaseRequired({ KLEDG_REQUIRE_TEST_DB: ' TRUE ' })).toBe(true)
  })

  it('skips database tests when the server is missing and the flag is not set', async () => {
    await expect(testDatabaseAvailable({ KLEDG_TEST_DATABASE_URL: unreachable })).resolves.toBe(false)
  })

  it('fails instead of skipping when the flag is set', async () => {
    await expect(
      testDatabaseAvailable({ KLEDG_TEST_DATABASE_URL: unreachable, KLEDG_REQUIRE_TEST_DB: 'true' }),
    ).rejects.toThrow(/KLEDG_REQUIRE_TEST_DB is set but the test PostgreSQL server at 127\.0\.0\.1:9 does not answer/)
  })
})
