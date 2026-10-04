/**
 * KLEDG-SEC-011 (kledg-cloud KLEDG-CLOUD-004): account pre-registration
 * takeover. On an instance whose policy opens sign-up and requires confirmed
 * addresses (the hosted policy), anyone can register a colleague's address
 * first. When an administrator then adds that address to a company, the
 * existing account must not keep what its registrant set up (password,
 * sessions, API keys, assistant grants): it is reset like a new account and
 * the person chooses their own password. A confirmed account is added as it
 * is. Real Better Auth and PostgreSQL, mail delivery mocked. Skipped when the
 * test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('security_preregistration')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { emailEnabled: true, mails: [] as Array<{ to: string; subject: string; text: string }> }
})

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (message: { to: string; subject: string; text: string }) => {
    state.mails.push(message)
  }),
  isEmailEnabled: async () => state.emailEnabled,
}))

// The hosted instance policy: public sign-up (served by the instance) and confirmed addresses required.
vi.mock('@/lib/instance/policy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instance/policy')>()),
  REQUIRE_EMAIL_VERIFICATION: true,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let addMemberToCompany: typeof import('@/lib/rbac/add-member-to-company.service').addMemberToCompany
let createApiKeyWithGrant: typeof import('@/lib/ai-access/create-api-key.service').createApiKeyWithGrant

const VICTIM = 'claire.martin@example.fr'
const ATTACKER_PASSWORD = 'attacker-chose-this-1'
let companyId: string

/** What the instance's public sign-up does for the attacker: an unconfirmed account with their password, a session and an all-companies API key. */
async function preRegister(): Promise<string> {
  await auth.api.createUser({ body: { email: VICTIM, password: ATTACKER_PASSWORD, name: 'Mallory', role: 'user' } })
  const user = await prisma.user.findUniqueOrThrow({ where: { email: VICTIM } })
  expect(user.emailVerified).toBe(false)
  await prisma.session.create({ data: { id: 's-attacker', token: 'attacker-session-token', userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } })
  await createApiKeyWithGrant({ id: user.id, email: VICTIM, name: 'Mallory', role: 'user' }, 'mallory', { allCompanies: true, companyIds: [] }, 'admin', 'automatic')
  return user.id
}

async function signIn(password: string): Promise<boolean> {
  try {
    await auth.api.signInEmail({ body: { email: VICTIM, password } })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!available)('[KLEDG-SEC-011] adding an unconfirmed account to a company', () => {
  beforeAll(async () => {
    await prepareTestDatabase('security_preregistration')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    ;({ addMemberToCompany } = await import('@/lib/rbac/add-member-to-company.service'))
    ;({ createApiKeyWithGrant } = await import('@/lib/ai-access/create-api-key.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('security_preregistration')
    state.emailEnabled = true
    state.mails.length = 0
    companyId = (await prisma.company.create({ data: { name: 'Atelier Alpha', slug: 'atelier-alpha', siren: '111111111' } })).id
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('resets the account like a new one: no session, password, key or grant of its registrant survives', async () => {
    const userId = await preRegister()
    const result = await addMemberToCompany({ companyId, email: VICTIM, name: 'Claire Martin', role: 'accountant' })

    expect(result).toMatchObject({ userId, createdUser: false, resetUnconfirmedUser: true, welcomeEmailSent: true })
    expect(result.generatedPassword).toBeUndefined()
    expect(await prisma.session.count({ where: { userId } })).toBe(0)
    expect(await prisma.apikey.count({ where: { referenceId: userId } })).toBe(0)
    expect(await prisma.aiAccessGrant.count({ where: { userId } })).toBe(0)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ emailVerified: true, name: 'Claire Martin' })
    // The address is confirmed now, and still the registrant's password does not open the account.
    expect(await signIn(ATTACKER_PASSWORD)).toBe(false)
    await vi.waitFor(() => expect(state.mails.some((m) => m.to === VICTIM && m.text.includes('Choisissez votre mot de passe'))).toBe(true))
    expect(await prisma.member.count({ where: { userId, organization: { companyId } } })).toBe(1)
  })

  it('without email, hands the administrator a new password that alone opens the account', async () => {
    state.emailEnabled = false
    await preRegister()
    const result = await addMemberToCompany({ companyId, email: VICTIM, role: 'viewer' })
    expect(result.resetUnconfirmedUser).toBe(true)
    expect(result.generatedPassword).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(await signIn(ATTACKER_PASSWORD)).toBe(false)
    expect(await signIn(result.generatedPassword!)).toBe(true)
  })

  it('adds a confirmed account as it is (its sessions and password stay)', async () => {
    await auth.api.createUser({ body: { email: VICTIM, password: 'her-own-password-1', name: 'Claire', role: 'user' } })
    const user = await prisma.user.update({ where: { email: VICTIM }, data: { emailVerified: true } })
    await prisma.session.create({ data: { id: 's-claire', token: 'claire-session-token', userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } })
    const result = await addMemberToCompany({ companyId, email: VICTIM, role: 'viewer' })
    expect(result).toMatchObject({ createdUser: false, resetUnconfirmedUser: false, welcomeEmailSent: false })
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1)
    expect(await signIn('her-own-password-1')).toBe(true)
    expect(state.mails).toEqual([])
  })
})
