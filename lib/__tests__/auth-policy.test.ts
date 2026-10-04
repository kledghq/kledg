import { afterEach, describe, expect, it } from 'vitest'
import { authRateLimit, isAccountRouteOnlyPath, isOrganizationMutationPath, isUserRouteOnlyPath } from '@/lib/auth-policy'

afterEach(() => {
  delete process.env.VERCEL
  delete process.env.RATE_LIMIT_IP_HEADER
})

describe('organization endpoints', () => {
  it('blocks mutations for non administrators', () => {
    for (const path of [
      '/organization/create',
      '/organization/update',
      '/organization/delete',
      '/organization/invite-member',
      '/organization/add-member',
      '/organization/remove-member',
      '/organization/update-member-role',
      '/organization/accept-invitation',
      '/organization/cancel-invitation',
      '/organization/leave',
      '/organization/create-team',
      '/organization/some-future-endpoint',
    ]) {
      expect(isOrganizationMutationPath(path), path).toBe(true)
    }
  })

  it('lets reads and unrelated paths through', () => {
    for (const path of ['/organization/list', '/organization/get-full-organization', '/organization/list-members', '/get-session', '/sign-in/email']) {
      expect(isOrganizationMutationPath(path), path).toBe(false)
    }
  })
})

describe('rate limiting', () => {
  it('stores counters in the database and limits sensitive endpoints', () => {
    expect(authRateLimit.storage).toBe('database')
    expect(authRateLimit.customRules['/sign-in/*'].max).toBeLessThanOrEqual(10)
    expect(authRateLimit.customRules['/request-password-reset'].max).toBeLessThanOrEqual(5)
    expect(authRateLimit.customRules['/oauth2/register'].max).toBeLessThanOrEqual(20)
  })
})

describe('account endpoints reserved to the account routes', () => {
  it('closes email change and account deletion over HTTP', () => {
    for (const path of ['/change-email', '/delete-user', '/delete-user/callback']) {
      expect(isAccountRouteOnlyPath(path), path).toBe(true)
    }
  })

  it('leaves the other account endpoints open', () => {
    for (const path of ['/change-password', '/update-user', '/verify-email', '/get-session', '/list-sessions']) {
      expect(isAccountRouteOnlyPath(path), path).toBe(false)
    }
  })
})

describe('admin endpoints reserved to the instance user management', () => {
  it('closes role, ban, email and deletion changes over HTTP', () => {
    for (const path of ['/admin/set-role', '/admin/ban-user', '/admin/unban-user', '/admin/update-user', '/admin/remove-user']) {
      expect(isUserRouteOnlyPath(path), path).toBe(true)
    }
  })

  it('closes every admin endpoint over HTTP, impersonation and account creation included', () => {
    for (const path of ['/admin/create-user', '/admin/list-users', '/admin/impersonate-user', '/admin/set-user-password', '/admin/revoke-user-sessions']) {
      expect(isUserRouteOnlyPath(path), path).toBe(true)
    }
  })

  it('leaves the user own endpoints open', () => {
    for (const path of ['/update-user', '/get-session', '/sign-in/email']) {
      expect(isUserRouteOnlyPath(path), path).toBe(false)
    }
  })
})
