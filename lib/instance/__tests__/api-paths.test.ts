/**
 * Self-authenticated API paths of the instance policy
 * (SELF_AUTHENTICATED_API_ROUTES, lib/instance/policy.ts): the request proxy
 * lets them through without a session, so a declared path must cover its
 * own routes only, matched on path segments (`/api/demo` never covers
 * `/api/demo-admin`).
 */

import { describe, expect, it } from 'vitest'
import { isSelfAuthenticatedApiPath } from '../api-paths'
import { SELF_AUTHENTICATED_API_ROUTES } from '../policy'

const DEMO = { '/api/demo': 'Demo reset, authenticated by its own token' }
const DEMO_SLASH = { '/api/demo/': 'Demo reset, authenticated by its own token' }

describe('self-authenticated API paths', () => {
  it('are none in Kledg', () => {
    expect(SELF_AUTHENTICATED_API_ROUTES).toEqual({})
    expect(isSelfAuthenticatedApiPath('/api/demo')).toBe(false)
  })

  it('[KLEDG-SEC-016] match the declared path and the paths under it, with or without a trailing slash', () => {
    for (const routes of [DEMO, DEMO_SLASH]) {
      expect(isSelfAuthenticatedApiPath('/api/demo', routes)).toBe(true)
      expect(isSelfAuthenticatedApiPath('/api/demo/', routes)).toBe(true)
      expect(isSelfAuthenticatedApiPath('/api/demo/reset', routes)).toBe(true)
    }
  })

  it('[KLEDG-SEC-016] never match a longer segment or another path', () => {
    for (const routes of [DEMO, DEMO_SLASH]) {
      expect(isSelfAuthenticatedApiPath('/api/demo-admin', routes)).toBe(false)
      expect(isSelfAuthenticatedApiPath('/api/demo-admin/users', routes)).toBe(false)
      expect(isSelfAuthenticatedApiPath('/api/demos', routes)).toBe(false)
      expect(isSelfAuthenticatedApiPath('/api/companies', routes)).toBe(false)
      expect(isSelfAuthenticatedApiPath('/api', routes)).toBe(false)
    }
  })
})
