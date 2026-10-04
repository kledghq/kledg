/**
 * REQUIRE_EMAIL_VERIFICATION (lib/instance/policy.ts) drives Better Auth's
 * requireEmailVerification and sendOnSignIn (lib/auth.ts). Kledg leaves both
 * off: accounts are created by the instance administrator.
 */

import { describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  // Better Auth is configured at import time; no query runs here.
  process.env.DATABASE_URL ??= process.env.KLEDG_TEST_DATABASE_URL ?? 'postgresql://kledg:kledg@localhost:55432/postgres'
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
})

import { REQUIRE_EMAIL_VERIFICATION } from '../policy'
import { auth } from '@/lib/auth'

describe('email verification required by the instance policy', () => {
  it('is off in Kledg', () => {
    expect(REQUIRE_EMAIL_VERIFICATION).toBe(false)
  })

  it('configures Better Auth from the policy', () => {
    const options = auth.options as {
      emailAndPassword?: { requireEmailVerification?: boolean; disableSignUp?: boolean }
      emailVerification?: { sendOnSignIn?: boolean }
    }
    expect(options.emailAndPassword?.requireEmailVerification).toBe(REQUIRE_EMAIL_VERIFICATION)
    expect(options.emailVerification?.sendOnSignIn).toBe(REQUIRE_EMAIL_VERIFICATION)
    // Public sign-up through Better Auth stays closed whatever the policy says.
    expect(options.emailAndPassword?.disableSignUp).toBe(true)
  })
})
