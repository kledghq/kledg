/**
 * Data migration 20261011110000_keep_existing_rules_auto_applied against
 * PostgreSQL: the enabled rules created before the change get "Créer
 * automatiquement l'écriture", so the header refresh keeps creating their
 * entries; disabled rules, rules already marked and rules created after the
 * migration ran keep their value, also when it runs again. Skipped without
 * the test database server.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('keep_rules_auto_applied')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261011110000_keep_existing_rules_auto_applied/migration.sql'),
  'utf8',
)

let prisma: typeof import('@/lib/prisma').prisma

describe.skipIf(!available)('migration 20261011110000_keep_existing_rules_auto_applied', () => {
  beforeAll(async () => {
    await prepareTestDatabase('keep_rules_auto_applied')
    ;({ prisma } = await import('@/lib/prisma'))
  }, 60_000)

  it('marks the enabled rules created before it, once', async () => {
    const company = await prisma.company.create({ data: { name: 'Atelier Lumen', slug: 'atelier-lumen', siren: '111111111' } })
    const rule = (name: string, data: { enabled?: boolean; autoCreate?: boolean; createdAt?: Date } = {}) =>
      prisma.transactionRule.create({ data: { companyId: company.id, name, ...data } })
    const before = new Date('2026-09-01T10:00:00Z')
    const enabled = await rule('Loyer', { createdAt: before })
    const disabled = await rule('Ancienne règle', { enabled: false, createdAt: before })
    const marked = await rule('Abonnements', { autoCreate: true, createdAt: before })

    await prisma.$executeRawUnsafe(MIGRATION)

    const autoCreate = async (id: string) => (await prisma.transactionRule.findUniqueOrThrow({ where: { id } })).autoCreate
    expect(await autoCreate(enabled.id)).toBe(true)
    expect(await autoCreate(disabled.id)).toBe(false)
    expect(await autoCreate(marked.id)).toBe(true)

    // A rule created after the migration ran, box unchecked in the dialog: a second run leaves it alone
    await prisma.$executeRawUnsafe(`CREATE TABLE "_prisma_migrations" ("migration_name" text, "started_at" timestamptz)`)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" VALUES ('20261011110000_keep_existing_rules_auto_applied', '2026-10-01T00:00:00Z')`,
    )
    const later = await rule('Nouvelle règle', { createdAt: new Date('2026-10-05T09:00:00Z') })
    await prisma.$executeRawUnsafe(MIGRATION)
    expect(await autoCreate(later.id)).toBe(false)
    expect(await autoCreate(enabled.id)).toBe(true)
    await prisma.$executeRawUnsafe(`DROP TABLE "_prisma_migrations"`)
  })
})
