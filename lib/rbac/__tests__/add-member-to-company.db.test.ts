/**
 * addMemberToCompany and ensureCompanyOrganization (lib/rbac) against
 * PostgreSQL and the real Better Auth instance, with only the mail delivery
 * mocked:
 * - a new user is created verified, with a generated password when email is
 *   off, or a "choose your password" welcome email when it is on;
 * - an existing confirmed user is added without a new account (an
 *   unconfirmed one is reset first: lib/__tests__/security/account-preregistration.db.test.ts);
 * - one membership per user and company, valid roles only, French errors;
 * - the company's organization is created once, with a readable slug.
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_bank_add_member')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.RATE_LIMIT_DISABLED = 'true'
  return { emailEnabled: false, mails: [] as Array<{ to: string; subject: string; text: string }> }
})

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (message: { to: string; subject: string; text: string }) => {
    state.mails.push(message)
  }),
  isEmailEnabled: async () => state.emailEnabled,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let auth: typeof import('@/lib/auth').auth
let addMemberToCompany: typeof import('@/lib/rbac/add-member-to-company.service').addMemberToCompany
let ensureCompanyOrganization: typeof import('@/lib/rbac/ensure-company-organization.service').ensureCompanyOrganization

let companyId: string

describe.skipIf(!available)('addMemberToCompany', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_bank_add_member')
    ;({ prisma } = await import('@/lib/prisma'))
    ;({ auth } = await import('@/lib/auth'))
    ;({ addMemberToCompany } = await import('@/lib/rbac/add-member-to-company.service'))
    ;({ ensureCompanyOrganization } = await import('@/lib/rbac/ensure-company-organization.service'))
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('cov_bank_add_member')
    state.emailEnabled = false
    state.mails.length = 0
    const company = await prisma.company.create({ data: { name: 'Atelier Été & Co', slug: 'atelier-ete', siren: '111111111' } })
    companyId = company.id
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates a verified user with a generated password when email is off, and its membership', async () => {
    const result = await addMemberToCompany({ companyId, email: '  Marie.Durand@Example.FR ', name: ' Marie Durand ', role: 'accountant' })

    expect(result).toMatchObject({ createdUser: true, welcomeEmailSent: false, roles: ['accountant'] })
    expect(result.generatedPassword).toMatch(/^[A-Za-z0-9_-]{16}$/)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'marie.durand@example.fr' } })
    expect(user).toMatchObject({ id: result.userId, name: 'Marie Durand', emailVerified: true, role: 'user' })

    const member = await prisma.member.findUniqueOrThrow({ where: { id: result.memberId } })
    expect(member).toMatchObject({ userId: user.id, role: 'accountant' })
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: member.organizationId } })
    expect(organization).toMatchObject({ companyId, name: 'Atelier Été & Co', slug: `atelier-ete-co-${companyId.slice(-6)}` })

    // The administrator passes the password on: it signs in
    const signIn = await auth.api.signInEmail({ body: { email: 'marie.durand@example.fr', password: result.generatedPassword! } })
    expect(signIn.user.id).toBe(user.id)
    expect(state.mails).toEqual([])
  })

  it('names a user without a name after the local part of the email', async () => {
    const result = await addMemberToCompany({ companyId, email: 'paul@example.fr', role: 'viewer' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: result.userId } })).name).toBe('paul')
  })

  it('sends the welcome email instead of returning a password when email is on', async () => {
    state.emailEnabled = true
    const result = await addMemberToCompany({ companyId, email: 'lea@example.fr', role: 'viewer' })
    expect(result).toMatchObject({ createdUser: true, welcomeEmailSent: true })
    expect(result.generatedPassword).toBeUndefined()
    await vi.waitFor(() => expect(state.mails).toHaveLength(1))
    expect(state.mails[0]).toMatchObject({ to: 'lea@example.fr', subject: 'Votre accès à Kledg' })
    expect(state.mails[0].text).toContain('Choisissez votre mot de passe')
    expect(decodeURIComponent(state.mails[0].text)).toContain('/reset-password?welcome=1')
  })

  it('[KLEDG-R3-INPUT-06] a reset asked with welcome=1 in the URL is a plain reset email', async () => {
    state.emailEnabled = true
    await prisma.user.create({ data: { id: 'u-known', email: 'connu@example.fr', name: 'Connu', emailVerified: true } })
    await auth.api.requestPasswordReset({ body: { email: 'connu@example.fr', redirectTo: '/reset-password?welcome=1' } })
    await vi.waitFor(() => expect(state.mails).toHaveLength(1))
    expect(state.mails[0].subject).not.toBe('Votre accès à Kledg')
    expect(state.mails[0].text).toContain('Réinitialisez votre mot de passe')
  })

  it('[KLEDG-R3-INPUT-06] sends the welcome email at most 3 times a day to the same person', async () => {
    state.emailEnabled = true
    await prisma.user.create({ data: { id: 'u-unconfirmed', email: 'nouveau@example.fr', name: 'Nouveau', emailVerified: false } })
    await prisma.rateLimit.deleteMany({ where: { key: 'welcome-email|u-unconfirmed' } })
    await prisma.rateLimit.create({ data: { id: 'rl-welcome', key: 'welcome-email|u-unconfirmed', count: 3, lastRequest: BigInt(Date.now()) } })
    delete process.env.RATE_LIMIT_DISABLED
    try {
      const result = await addMemberToCompany({ companyId, email: 'nouveau@example.fr', role: 'viewer' })
      expect(result).toMatchObject({ resetUnconfirmedUser: true, welcomeEmailSent: false })
      expect(state.mails).toEqual([])
    } finally {
      process.env.RATE_LIMIT_DISABLED = 'true'
    }
  })

  it('adds an existing user without creating an account', async () => {
    await prisma.user.create({ data: { id: 'u-existing', email: 'deja@example.fr', name: 'Déjà là', emailVerified: true } })
    const result = await addMemberToCompany({ companyId, email: 'DEJA@example.fr', role: 'companyAdmin' })
    expect(result).toEqual({
      userId: 'u-existing',
      memberId: result.memberId,
      createdUser: false,
      resetUnconfirmedUser: false,
      generatedPassword: undefined,
      welcomeEmailSent: false,
      roles: ['companyAdmin'],
    })
    expect(await prisma.user.count()).toBe(1)
    expect(await prisma.member.count({ where: { userId: 'u-existing', role: 'companyAdmin' } })).toBe(1)
  })

  it('refuses a second membership in the same company with a 409', async () => {
    await addMemberToCompany({ companyId, email: 'marie@example.fr', role: 'viewer' })
    await expect(addMemberToCompany({ companyId, email: 'marie@example.fr', role: 'accountant' })).rejects.toThrow(
      new ConflictError('Cet utilisateur est déjà membre de cette société'),
    )
    expect(await prisma.member.count()).toBe(1)
  })

  it('validates the email, the role and the company in French before writing', async () => {
    await expect(addMemberToCompany({ companyId, email: '   ', role: 'viewer' })).rejects.toThrow(new ValidationError("L'email est requis"))
    await expect(
      addMemberToCompany({ companyId, email: 'a@example.fr', role: 'owner' as unknown as 'viewer' }),
    ).rejects.toThrow(new ValidationError('Rôle invalide. Valeurs acceptées : companyAdmin, accountant, viewer'))
    await expect(addMemberToCompany({ companyId: 'missing', email: 'a@example.fr', role: 'viewer' })).rejects.toThrow(
      new NotFoundError('Société introuvable'),
    )
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.organization.count()).toBe(0)
  })
})

describe.skipIf(!available)('ensureCompanyOrganization', () => {
  beforeEach(async () => {
    await prepareTestDatabase('cov_bank_add_member')
  })

  it('creates the organization once and returns it afterwards', async () => {
    const company = await prisma.company.create({ data: { name: 'Bureau Beta', slug: 'bureau-beta', siren: '222222222' } })
    const first = await ensureCompanyOrganization(company.id)
    expect(first).toMatchObject({ id: company.id, companyId: company.id, name: 'Bureau Beta', slug: `bureau-beta-${company.id.slice(-6)}` })
    await prisma.company.update({ where: { id: company.id }, data: { name: 'Bureau Gamma' } })
    const second = await ensureCompanyOrganization(company.id)
    expect(second).toEqual(first)
    expect(await prisma.organization.count()).toBe(1)
  })

  it('falls back to company-<suffix> for a name without letters or digits, and cuts long names', async () => {
    const symbols = await prisma.company.create({ data: { name: '***', slug: 'symbols', siren: '333333333' } })
    expect((await ensureCompanyOrganization(symbols.id)).slug).toBe(`company-${symbols.id.slice(-6)}`)

    const long = await prisma.company.create({ data: { name: 'A'.repeat(60), slug: 'long', siren: '444444444' } })
    expect((await ensureCompanyOrganization(long.id)).slug).toBe(`${'a'.repeat(40)}-${long.id.slice(-6)}`)
  })

  it('throws for an unknown company', async () => {
    await expect(ensureCompanyOrganization('missing')).rejects.toThrow('Company not found: missing')
  })
})
