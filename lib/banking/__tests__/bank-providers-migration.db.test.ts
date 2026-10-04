/**
 * Data statement of migration 20261004120000_bank_providers against
 * PostgreSQL: each existing Qonto bank connection is linked to the latest
 * QONTO BANKING integration of its company (the one holding its
 * credentials). Connections already linked, other providers and companies
 * without a Qonto integration are left alone; running it twice changes
 * nothing. Skipped without the test database server.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('cov_bank_providers_migration')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const SQL = readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261004120000_bank_providers/migration.sql'), 'utf8')
/** The data statement only: the schema changes are already applied to the test database. */
const BACKFILL = SQL.slice(SQL.indexOf('-- Link existing Qonto connections'))

let prisma: typeof import('@/lib/prisma').prisma

let seq = 0
async function company() {
  seq += 1
  return prisma.company.create({ data: { name: `Société ${seq}`, slug: `societe-${seq}`, siren: String(100000000 + seq) } })
}

function integration(companyId: string, provider: 'QONTO' | 'PONTO', createdAt: string, type: 'BANKING' | 'STORAGE' = 'BANKING') {
  return prisma.integration.create({
    data: { companyId, provider, type, name: provider, credentials: {}, createdAt: new Date(createdAt) },
  })
}

const linkOf = async (id: string) => (await prisma.bankConnection.findUniqueOrThrow({ where: { id } })).integrationId

describe.skipIf(!available)('migration 20261004120000_bank_providers (Qonto connection backfill)', () => {
  beforeAll(async () => {
    await prepareTestDatabase('cov_bank_providers_migration')
    ;({ prisma } = await import('@/lib/prisma'))
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('is the last statement of the migration and only updates Qonto connections without a link', () => {
    expect(BACKFILL.trim().startsWith('-- Link existing Qonto connections')).toBe(true)
    expect(BACKFILL).toContain('UPDATE "bank_connections"')
    expect(BACKFILL).not.toMatch(/\b(ALTER|DROP|CREATE)\b/)
  })

  it('links each Qonto connection to the latest Qonto banking integration of its company, idempotently', async () => {
    // A: two Qonto integrations (the latest wins), a newer Ponto one and a non banking one are ignored
    const a = await company()
    await integration(a.id, 'QONTO', '2025-01-10T00:00:00Z')
    const aLatest = await integration(a.id, 'QONTO', '2026-03-01T00:00:00Z')
    await integration(a.id, 'PONTO', '2026-09-01T00:00:00Z')
    await integration(a.id, 'QONTO', '2026-09-15T00:00:00Z', 'STORAGE')
    const aQonto = await prisma.bankConnection.create({ data: { companyId: a.id, provider: 'QONTO' } })
    const aPontoConnection = await prisma.bankConnection.create({ data: { companyId: a.id, provider: 'PONTO' } })
    const aManual = await prisma.bankConnection.create({ data: { companyId: a.id, provider: 'MANUAL' } })

    // B: already linked to its older integration: kept
    const b = await company()
    const bOld = await integration(b.id, 'QONTO', '2025-01-01T00:00:00Z')
    await integration(b.id, 'QONTO', '2026-01-01T00:00:00Z')
    const bQonto = await prisma.bankConnection.create({ data: { companyId: b.id, provider: 'QONTO', integrationId: bOld.id } })

    // C: a Qonto connection with no integration in its company (another company's does not count)
    const c = await company()
    const cQonto = await prisma.bankConnection.create({ data: { companyId: c.id, provider: 'QONTO' } })

    await prisma.$executeRawUnsafe(BACKFILL)
    const first = await prisma.bankConnection.findMany({ orderBy: { id: 'asc' }, select: { id: true, integrationId: true } })
    await prisma.$executeRawUnsafe(BACKFILL)

    expect(await linkOf(aQonto.id)).toBe(aLatest.id)
    expect(await linkOf(aPontoConnection.id)).toBeNull()
    expect(await linkOf(aManual.id)).toBeNull()
    expect(await linkOf(bQonto.id)).toBe(bOld.id)
    expect(await linkOf(cQonto.id)).toBeNull()
    expect(await prisma.bankConnection.findMany({ orderBy: { id: 'asc' }, select: { id: true, integrationId: true } })).toEqual(first)
  })
})
