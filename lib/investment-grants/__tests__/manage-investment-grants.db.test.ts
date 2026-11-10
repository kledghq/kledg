/**
 * Changing an investment grant against PostgreSQL (lib/investment-grants/
 * manage-investment-grants.service.ts): the share already transferred to
 * the result before Kledg followed the grant (carriedAmount) keeps its
 * value when an update omits it, so a client that does not send it never
 * resets it (issue #29: the next year-end then transferred those sums a
 * second time). Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('investment_grants')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

let prisma: typeof import('@/lib/prisma').prisma
let service: typeof import('@/lib/investment-grants/manage-investment-grants.service')

const ids = {} as Record<string, string>

const BODY = { label: 'Subvention région', amountCents: 100_000, grantedOn: '2025-02-01', spreading: 'LINEAR' as const, durationYears: 5 }

describe.skipIf(!available)('updateInvestmentGrant: amount already transferred', () => {
  beforeAll(async () => {
    await prepareTestDatabase('investment_grants')
    ;({ prisma } = await import('@/lib/prisma'))
    service = await import('@/lib/investment-grants/manage-investment-grants.service')
  }, 60_000)

  beforeEach(async () => {
    await prepareTestDatabase('investment_grants')
    const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
    ids.company = company.id
    const grant = await service.createInvestmentGrant(company.id, { ...BODY, carriedCents: 20_000 })
    ids.grant = grant.id
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('keeps the stored amount when the update omits carriedCents', async () => {
    const updated = await service.updateInvestmentGrant(ids.company, ids.grant, { ...BODY, label: 'Subvention région Auvergne' })
    expect(updated.label).toBe('Subvention région Auvergne')
    expect(updated.carriedAmount.toString()).toBe('200')
  })

  it('replaces it when the update gives carriedCents, zero included', async () => {
    const more = await service.updateInvestmentGrant(ids.company, ids.grant, { ...BODY, carriedCents: 30_000 })
    expect(more.carriedAmount.toString()).toBe('300')
    const none = await service.updateInvestmentGrant(ids.company, ids.grant, { ...BODY, carriedCents: 0 })
    expect(none.carriedAmount.toString()).toBe('0')
  })

  it('still refuses an amount already transferred above the grant', async () => {
    await expect(service.updateInvestmentGrant(ids.company, ids.grant, { ...BODY, amountCents: 10_000 })).rejects.toThrow('Le montant déjà repris dépasse celui de la subvention.')
  })
})
