/**
 * Company identifiers checked within the scope of the instance policy
 * (companyIdentifierScope, lib/instance/policy.ts; KLEDG-R3-CLOUD-01),
 * against PostgreSQL:
 * - Kledg's default (null) keeps SIREN and SIRET unique across the
 *   instance, including companies the user cannot see;
 * - a scope limits the SIREN and SIRET checks to its companies, never the
 *   slug (part of company URLs);
 * - the company routes and the establishment service follow the policy.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('identifier_scope')
})

vi.mock('@/lib/instance/policy', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/instance/policy')>()
  return { ...real, companyIdentifierScope: vi.fn(real.companyIdentifierScope) }
})

import * as policy from '@/lib/instance/policy'
import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'
import { companyIdentifierTaken, legalIdentifierTaken } from '../identifiers'
import { withUserContext } from '@/lib/rls/context'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
const ids = {} as Record<'mine' | 'other', string>

describe.skipIf(!available)('company identifiers within the scope of the instance policy', () => {
  beforeAll(async () => {
    await prepareTestDatabase('identifier_scope')
    ;({ prisma } = await import('@/lib/prisma'))
    await prisma.user.create({ data: { id: 'u-scope', email: 'scope@test.local', name: 'Scope', role: 'user' } })
    ids.mine = (await prisma.company.create({ data: { name: 'Mienne', slug: 'mienne', siren: '912345675' } })).id
    ids.other = (await prisma.company.create({ data: { name: 'Autre', slug: 'autre', siren: '912345683' } })).id
    await prisma.establishment.create({ data: { companyId: ids.other, siret: '91234568300015', siren: '912345683', isMain: true } })
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it("Kledg's default: SIREN and SIRET unique across the instance, even for a user who sees no company", async () => {
    await withUserContext('u-scope', async () => {
      expect(await legalIdentifierTaken('siren', '912345683', { companyId: ids.mine })).toBe(true)
      expect(await legalIdentifierTaken('siren', '912345675', { companyId: ids.mine })).toBe(false)
      expect(await legalIdentifierTaken('siret', '91234568300015', { companyId: ids.mine })).toBe(true)
      expect(await legalIdentifierTaken('siren', '912345683', { companyId: null, actor: { id: 'u-scope', role: 'user' } })).toBe(true)
    })
    expect(policy.companyIdentifierScope).toHaveBeenCalledWith(null, { id: 'u-scope', role: 'user' })
  })

  it('[KLEDG-R3-CLOUD-01] a scope limits the SIREN and SIRET checks to its companies, never the slug', async () => {
    vi.mocked(policy.companyIdentifierScope).mockResolvedValueOnce([ids.mine]).mockResolvedValueOnce([ids.mine])
    expect(await legalIdentifierTaken('siren', '912345683', { companyId: ids.mine })).toBe(false)
    expect(await legalIdentifierTaken('siret', '91234568300015', { companyId: null, actor: { id: 'u-scope', role: 'user' } })).toBe(false)
    expect(await companyIdentifierTaken('siren', '912345675', null, prisma, [ids.mine])).toBe(true)
    expect(await companyIdentifierTaken('siren', '912345675', ids.mine, prisma, [ids.mine])).toBe(false)
    expect(await companyIdentifierTaken('siren', '912345683', null, prisma, [])).toBe(false)
    expect(await companyIdentifierTaken('slug', 'autre', ids.mine, prisma, [ids.mine])).toBe(true)
  })
})
