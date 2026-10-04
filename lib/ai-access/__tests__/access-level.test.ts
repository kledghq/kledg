import { describe, expect, it } from 'vitest'
import {
  accessLevelOf,
  apiKeyLevelOf,
  apiKeyPermissionsFor,
  availableLevels,
  capabilitiesOf,
  defaultLevel,
  scopesForLevel,
} from '@/lib/ai-access/access'

describe('access level of an assistant', () => {
  const requested = ['openid', 'offline_access', 'kledg:read', 'kledg:write', 'kledg:admin']

  it('reads the level from the granted scopes, kledg:admin implying kledg:write', () => {
    expect(accessLevelOf(requested)).toBe('admin')
    expect(accessLevelOf(['kledg:read', 'kledg:write'])).toBe('write')
    expect(accessLevelOf(['kledg:read'])).toBe('read')
    expect(accessLevelOf(undefined)).toBe('read')
    expect(capabilitiesOf(['kledg:admin'])).toEqual({ canRead: true, canWrite: true, canAdmin: true })
    expect(capabilitiesOf(['kledg:read', 'kledg:write'])).toEqual({ canRead: true, canWrite: true, canAdmin: false })
  })

  it('drops the Kledg scopes above the level, keeps the others, and never adds a scope', () => {
    expect(scopesForLevel(requested, 'read')).toEqual(['openid', 'offline_access', 'kledg:read'])
    expect(scopesForLevel(requested, 'write')).toEqual(['openid', 'offline_access', 'kledg:read', 'kledg:write'])
    expect(scopesForLevel(requested, 'admin')).toEqual(requested)
    expect(scopesForLevel(['kledg:read'], 'admin')).toEqual(['kledg:read'])
  })

  it('offers only the levels asked for, and never preselects full control', () => {
    expect(availableLevels(requested)).toEqual(['read', 'write', 'admin'])
    expect(availableLevels(['kledg:read', 'kledg:write'])).toEqual(['read', 'write'])
    expect(availableLevels(['kledg:read'])).toEqual(['read'])
    expect(defaultLevel(requested)).toBe('write')
    expect(defaultLevel(['kledg:read'])).toBe('read')
  })

  it('stores the level of an API key as permissions; a key without one is read-only (fail closed)', () => {
    expect(apiKeyPermissionsFor('read')).toEqual({ kledg: ['read'] })
    expect(apiKeyPermissionsFor('admin')).toEqual({ kledg: ['read', 'write', 'admin'] })
    for (const level of ['read', 'write', 'admin'] as const) expect(apiKeyLevelOf(apiKeyPermissionsFor(level))).toBe(level)
    expect(apiKeyLevelOf(null)).toBe('read')
    expect(apiKeyLevelOf({})).toBe('read')
  })
})
