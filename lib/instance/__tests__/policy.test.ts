import { describe, expect, it, vi } from 'vitest'
import { ForbiddenError, handleError } from '@/lib/accounting/errors'
import * as policy from '../policy'
import { assertActionAllowed, assertCompanyCreationAllowed, authActionOf, INSTANCE_ACTIONS, isActionAllowed, isSelfAuthenticatedApiPath } from '..'

// The real default policy, wrapped so one test can make it refuse.
vi.mock('../policy', async (importOriginal) => {
  const real = await importOriginal<typeof import('../policy')>()
  return {
    ...real,
    isActionAllowed: vi.fn(real.isActionAllowed),
    actionRefusalMessage: vi.fn(real.actionRefusalMessage),
    companyCreationRefusal: vi.fn(real.companyCreationRefusal),
  }
})

const admin = { id: 'u1', email: 'admin@example.com', role: 'admin' }

describe('default instance policy', () => {
  it('allows every action, signed in or anonymous', async () => {
    for (const action of INSTANCE_ACTIONS) {
      expect(await isActionAllowed(action, admin)).toBe(true)
      expect(await isActionAllowed(action, null)).toBe(true)
      await expect(assertActionAllowed(action, admin)).resolves.toBeUndefined()
    }
  })

  it('lets through exactly the self-authenticated paths the policy declares', () => {
    for (const prefix of Object.keys(policy.SELF_AUTHENTICATED_API_ROUTES)) {
      expect(isSelfAuthenticatedApiPath(prefix)).toBe(true)
      expect(isSelfAuthenticatedApiPath(`${prefix.replace(/\/$/, '')}/x`)).toBe(true)
    }
    // Kledg's own routes are never declared there (they use route wrappers or the routes test allowlist).
    expect(isSelfAuthenticatedApiPath('/api/companies')).toBe(false)
    expect(isSelfAuthenticatedApiPath('/api/auth/sign-in/email')).toBe(false)
    expect(isSelfAuthenticatedApiPath('/api/cron/sync-banks')).toBe(false)
  })

  it('has a French refusal message without dashes for every action', () => {
    for (const action of INSTANCE_ACTIONS) {
      const message = policy.actionRefusalMessage(action)
      expect(message.length).toBeGreaterThan(20)
      expect(message).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe('read-only companies', () => {
  it('are never decided by the default policy', async () => {
    expect(await policy.companyWriteRefusal('c1')).toBeNull()
  })
})

describe('company creation', () => {
  const user = { id: 'u2', email: 'user@example.com', role: 'user' }

  it('is reserved to instance administrators by default, and the creation hook does nothing', async () => {
    expect(await policy.companyCreationRefusal(admin)).toBeNull()
    expect(await policy.companyCreationRefusal(user)).toEqual({
      message: "La création de sociétés est réservée aux administrateurs de l'instance.",
    })
    await expect(policy.afterCompanyCreated('c1', user)).resolves.toBeUndefined()
  })

  it('answers a refusal with a 403, its link in the details', async () => {
    await expect(assertCompanyCreationAllowed(admin)).resolves.toBeUndefined()
    expect(handleError(await assertCompanyCreationAllowed(user).catch((e: unknown) => e))).toEqual({
      message: "La création de sociétés est réservée aux administrateurs de l'instance.",
      statusCode: 403,
      details: {},
    })
    vi.mocked(policy.companyCreationRefusal).mockResolvedValueOnce({
      message: 'Limite atteinte.',
      link: { label: "Changer d'offre", href: '/settings/billing' },
    })
    const error = await assertCompanyCreationAllowed(user).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ForbiddenError)
    expect(handleError(error)).toEqual({
      message: 'Limite atteinte.',
      statusCode: 403,
      details: { link: { label: "Changer d'offre", href: '/settings/billing' } },
    })
  })
})

describe('assertActionAllowed', () => {
  it('passes the actor to the policy and answers 403 with its message when refused', async () => {
    vi.mocked(policy.isActionAllowed).mockResolvedValueOnce(false)
    vi.mocked(policy.actionRefusalMessage).mockReturnValueOnce('Désactivé ici.')
    const error = await assertActionAllowed('delete-company', admin).catch((e: unknown) => e)
    expect(policy.isActionAllowed).toHaveBeenLastCalledWith('delete-company', admin)
    expect(error).toBeInstanceOf(ForbiddenError)
    expect(handleError(error)).toEqual({ message: 'Désactivé ici.', statusCode: 403 })
  })
})

describe('authActionOf', () => {
  it('maps the Better Auth endpoints that perform restrictable actions', () => {
    expect(authActionOf('/change-password')).toBe('change-password')
    expect(authActionOf('/request-password-reset')).toBe('change-password')
    expect(authActionOf('/reset-password')).toBe('change-password')
    expect(authActionOf('/change-email')).toBe('change-email')
    expect(authActionOf('/delete-user')).toBe('delete-account')
    expect(authActionOf('/organization/invite-member')).toBe('invite-member')
    expect(authActionOf('/organization/delete')).toBe('delete-company')
    expect(authActionOf('/admin/create-user')).toBe('manage-users')
    expect(authActionOf('/admin/set-role')).toBe('manage-users')
  })

  it('leaves sign-in and sessions alone', () => {
    expect(authActionOf('/sign-in/email')).toBeNull()
    expect(authActionOf('/get-session')).toBeNull()
    expect(authActionOf('/sign-out')).toBeNull()
    // Every /admin/* endpoint is closed over HTTP anyway (lib/auth-policy.ts).
    expect(authActionOf('/admin/list-users')).toBe('manage-users')
  })
})
