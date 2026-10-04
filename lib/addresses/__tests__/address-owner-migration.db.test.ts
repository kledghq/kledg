/**
 * Migration 20261014090000_address_owner_company against PostgreSQL: the
 * test drops addresses."companyId" to get back the schema before the
 * migration, seeds the edge cases with plain SQL, runs the migration, checks
 * the result, then runs it again (twice in one transaction) to check that
 * it is idempotent. Edge cases:
 * - an address shared by three companies (establishments of A and B, person
 *   of C): A keeps it, B and C get their own copy, links repointed;
 * - an address used by several links of one company (its own address, its
 *   headquarters, two establishments, a person): kept once, not copied;
 * - a person without a company: owned by the company of its oldest
 *   shareholder row; without any shareholder row, its address is an orphan;
 * - orphans (no link at all): deleted.
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { Client } from 'pg'

const url = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  return useTestDatabase('address_owner_migration')
})

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

const SQL = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261014090000_address_owner_company/migration.sql'),
  'utf8',
)

interface AddressRow {
  id: string
  companyId: string
  street: string
  street2: string | null
  postalCode: string
  city: string
  country: string
}

describe.skipIf(!available)('address owner migration', () => {
  let db: Client

  const one = async <T,>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T
  const address = (id: string) => one<AddressRow | undefined>(`SELECT * FROM "addresses" WHERE "id" = $1`, [id])
  const addressesOf = async (companyId: string) =>
    (await db.query<AddressRow>(`SELECT * FROM "addresses" WHERE "companyId" = $1 ORDER BY "street"`, [companyId])).rows
  const linkOf = async (table: string, column: string, id: string) =>
    (await one<Record<string, string | null>>(`SELECT "${column}" FROM "${table}" WHERE "id" = $1`, [id]))[column]

  async function snapshot() {
    const addresses = await db.query(`SELECT "id", "companyId", "street" FROM "addresses" ORDER BY "id"`)
    const companies = await db.query(`SELECT "id", "addressId", "headquartersAddressId" FROM "companies" ORDER BY "id"`)
    const establishments = await db.query(`SELECT "id", "addressId" FROM "establishments" ORDER BY "id"`)
    const persons = await db.query(`SELECT "id", "addressId" FROM "persons" ORDER BY "id"`)
    return { addresses: addresses.rows, companies: companies.rows, establishments: establishments.rows, persons: persons.rows }
  }

  beforeAll(async () => {
    await prepareTestDatabase('address_owner_migration')
    db = new Client({ connectionString: url })
    await db.connect()

    // The schema before the migration: no owner column (its index and foreign key go with it).
    await db.query(`ALTER TABLE "addresses" DROP COLUMN "companyId"`)

    const addr = (id: string, street: string, street2: string | null = null) =>
      db.query(
        `INSERT INTO "addresses" ("id", "street", "street2", "postalCode", "city", "country", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, '75001', 'Paris', 'FR', '2026-01-01', '2026-01-01')`,
        [id, street, street2],
      )
    await addr('shared', '1 rue Commune', 'Bâtiment B')
    await addr('same-company', '2 rue Alpha')
    await addr('orphan', '3 rue Oubliée')
    await addr('shareholder-person', '4 rue Associé')
    await addr('lonely-person', '5 rue Seule')
    await addr('b-own', '6 rue Beta')

    const company = (id: string, siren: string, addressId: string | null, headquartersAddressId: string | null) =>
      db.query(
        `INSERT INTO "companies" ("id", "name", "slug", "siren", "addressId", "headquartersAddressId", "createdAt", "updatedAt")
         VALUES ($1, $1, $1, $2, $3, $4, now(), now())`,
        [id, siren, addressId, headquartersAddressId],
      )
    // A: its own address and its headquarters on the same address
    await company('company-a', '111111111', 'same-company', 'same-company')
    await company('company-b', '222222222', null, 'b-own')
    await company('company-c', '333333333', null, null)

    const establishment = (id: string, companyId: string, siret: string, addressId: string | null) =>
      db.query(
        `INSERT INTO "establishments" ("id", "companyId", "siret", "addressId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())`,
        [id, companyId, siret, addressId],
      )
    await establishment('est-a1', 'company-a', '11111111100011', 'same-company')
    await establishment('est-a2', 'company-a', '11111111100029', 'same-company')
    await establishment('est-a-shared', 'company-a', '11111111100037', 'shared')
    await establishment('est-b-shared', 'company-b', '22222222200011', 'shared')

    const person = (id: string, companyId: string | null, addressId: string | null) =>
      db.query(
        `INSERT INTO "persons" ("id", "firstName", "name", "companyId", "addressId", "createdAt", "updatedAt")
         VALUES ($1, 'Prénom', $1, $2, $3, now(), now())`,
        [id, companyId, addressId],
      )
    await person('person-a', 'company-a', 'same-company')
    await person('person-c-shared', 'company-c', 'shared')
    // No company: shareholder of B (oldest row) and of C
    await person('person-shareholder', null, 'shareholder-person')
    await person('person-lonely', null, 'lonely-person')

    const shareholder = (id: string, companyId: string, personId: string, createdAt: string) =>
      db.query(
        `INSERT INTO "shareholders" ("id", "companyId", "type", "personId", "sharePercentage", "createdAt", "updatedAt")
         VALUES ($1, $2, 'PHYSICAL', $3, 10, $4, now())`,
        [id, companyId, personId, createdAt],
      )
    await shareholder('sh-c', 'company-c', 'person-shareholder', '2026-03-01')
    await shareholder('sh-b', 'company-b', 'person-shareholder', '2026-02-01')

    await db.query(SQL)
  }, 60_000)

  afterAll(async () => {
    await db?.end()
  })

  it('gives every address an owner, required, with a cascading foreign key and an index', async () => {
    const column = await one<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'addresses' AND column_name = 'companyId'`,
    )
    expect(column.is_nullable).toBe('NO')
    const fk = await one<{ confdeltype: string; target: string }>(
      `SELECT confdeltype, confrelid::regclass::text AS target FROM pg_constraint WHERE conname = 'addresses_companyId_fkey'`,
    )
    expect(fk).toEqual({ confdeltype: 'c', target: 'companies' })
    const index = await one<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'addresses_companyId_idx'`)
    expect(index.indexdef).toContain('("companyId")')
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM "addresses" WHERE "companyId" IS NULL`)).n).toBe(0)
  })

  it('splits an address shared by three companies: the first link keeps it, the others get a copy', async () => {
    // A and B link it through an establishment (A first by company id), C through a person
    expect((await address('shared'))?.companyId).toBe('company-a')
    expect(await linkOf('establishments', 'addressId', 'est-a-shared')).toBe('shared')

    const bCopy = await linkOf('establishments', 'addressId', 'est-b-shared')
    const cCopy = await linkOf('persons', 'addressId', 'person-c-shared')
    expect(bCopy).not.toBe('shared')
    expect(cCopy).not.toBe('shared')
    expect(bCopy).not.toBe(cCopy)
    for (const [id, owner] of [[bCopy, 'company-b'], [cCopy, 'company-c']] as const) {
      expect(await address(id!)).toMatchObject({
        companyId: owner,
        street: '1 rue Commune',
        street2: 'Bâtiment B',
        postalCode: '75001',
        city: 'Paris',
        country: 'FR',
      })
    }
  })

  it('keeps an address used by several links of one company once', async () => {
    expect((await address('same-company'))?.companyId).toBe('company-a')
    expect(await linkOf('companies', 'addressId', 'company-a')).toBe('same-company')
    expect(await linkOf('companies', 'headquartersAddressId', 'company-a')).toBe('same-company')
    expect(await linkOf('establishments', 'addressId', 'est-a1')).toBe('same-company')
    expect(await linkOf('establishments', 'addressId', 'est-a2')).toBe('same-company')
    expect(await linkOf('persons', 'addressId', 'person-a')).toBe('same-company')
    expect((await addressesOf('company-a')).map((a) => a.id)).toEqual(['shared', 'same-company'])
  })

  it("owns a company-less person's address by its oldest shareholder company", async () => {
    expect((await address('shareholder-person'))?.companyId).toBe('company-b')
    expect(await linkOf('persons', 'addressId', 'person-shareholder')).toBe('shareholder-person')
    expect((await address('b-own'))?.companyId).toBe('company-b')
  })

  it('deletes the addresses no company reaches', async () => {
    expect(await address('orphan')).toBeUndefined()
    expect(await address('lonely-person')).toBeUndefined()
    expect(await linkOf('persons', 'addressId', 'person-lonely')).toBeNull()
  })

  it('leaves no address shared across companies', async () => {
    const shared = await db.query(`
      WITH links AS (
        SELECT "addressId", "id" AS "companyId" FROM "companies" WHERE "addressId" IS NOT NULL
        UNION ALL SELECT "headquartersAddressId", "id" FROM "companies" WHERE "headquartersAddressId" IS NOT NULL
        UNION ALL SELECT "addressId", "companyId" FROM "establishments" WHERE "addressId" IS NOT NULL
        UNION ALL SELECT "addressId", "companyId" FROM "persons" WHERE "addressId" IS NOT NULL AND "companyId" IS NOT NULL
      )
      SELECT l."addressId" FROM links l JOIN "addresses" a ON a."id" = l."addressId" WHERE a."companyId" <> l."companyId"`)
    expect(shared.rows).toEqual([])
  })

  it('is idempotent, also run twice in one transaction', async () => {
    const before = await snapshot()
    await db.query(SQL)
    await db.query('BEGIN')
    await db.query(SQL)
    await db.query(SQL)
    await db.query('COMMIT')
    expect(await snapshot()).toEqual(before)
  })

  it('knows every foreign key to addresses', async () => {
    // The migration reads the links below. A new column pointing at an
    // address must be added to the address service (owner check, clean-up)
    // and, for existing rows, to a new migration.
    const foreignKeys = await db.query<{ link: string }>(`
      SELECT conrelid::regclass::text || '.' || a.attname AS link
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'addresses'::regclass
      ORDER BY link`)
    expect(foreignKeys.rows.map((r) => r.link)).toEqual([
      'companies.addressId',
      'companies.headquartersAddressId',
      'establishments.addressId',
      'persons.addressId',
      // Tiers (20261019090000) create their address through createCompanyAddress and are in deleteAddressesIfUnused
      'tiers.addressId',
    ])
  })
})
