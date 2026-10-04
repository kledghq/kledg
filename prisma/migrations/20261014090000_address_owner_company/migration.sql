-- Every address gets an owning company (addresses."companyId", required,
-- FK to companies ON DELETE CASCADE, indexed). Until now an address had no
-- company column: a company reached it through its links, and an address
-- linked to nothing yet could be attached by any company knowing its id.
-- Additive, no destructive step; safe to run again (each step only touches
-- rows the previous run left unresolved).
--
-- A link is a column pointing at an address, and each link belongs to one
-- company:
--   companies."addressId"              -> that company
--   companies."headquartersAddressId"  -> that company
--   establishments."addressId"         -> establishments."companyId"
--   persons."addressId"                -> persons."companyId"; for a person
--                                         without one, the company of its
--                                         oldest shareholder row
-- Nothing else refers to an address (the test of this migration lists every
-- foreign key to addresses).
--
-- Steps:
--   1. add "companyId", nullable;
--   2. backfill: an address belongs to the company of its first link
--      (company address, headquarters, establishment, person, then the
--      smallest company id);
--   3. an address linked by several companies (possible through the
--      cross-tenant dedupe of POST /api/addresses fixed in a2eb009, or a
--      person shared by two companies): each other company gets its own
--      copy, with a deterministic id so a second run reuses it, and its links
--      are repointed to the copy. No address stays shared across companies;
--   4. delete the addresses no link uses (no owner found): orphans left by
--      replaced links and addresses created but never attached;
--   5. "companyId" NOT NULL, foreign key and index.
-- Test: lib/addresses/__tests__/address-owner-migration.db.test.ts.

-- 1. Column
ALTER TABLE "addresses" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- 2 to 4, atomically.
DO $$
BEGIN
  IF to_regclass('pg_temp.kledg_address_links') IS NULL THEN
    CREATE TEMP TABLE kledg_address_links (
      "addressId" TEXT NOT NULL,
      "companyId" TEXT NOT NULL,
      "priority"  INTEGER NOT NULL
    ) ON COMMIT DROP;
  ELSE
    DELETE FROM kledg_address_links;
  END IF;

  INSERT INTO kledg_address_links ("addressId", "companyId", "priority")
  SELECT c."addressId", c."id", 1 FROM "companies" c WHERE c."addressId" IS NOT NULL
  UNION ALL
  SELECT c."headquartersAddressId", c."id", 2 FROM "companies" c WHERE c."headquartersAddressId" IS NOT NULL
  UNION ALL
  SELECT e."addressId", e."companyId", 3 FROM "establishments" e WHERE e."addressId" IS NOT NULL
  UNION ALL
  SELECT p."addressId", owner."companyId", 4
  FROM "persons" p
  CROSS JOIN LATERAL (
    SELECT coalesce(
      p."companyId",
      (SELECT s."companyId" FROM "shareholders" s WHERE s."personId" = p."id" ORDER BY s."createdAt", s."id" LIMIT 1)
    ) AS "companyId"
  ) owner
  WHERE p."addressId" IS NOT NULL AND owner."companyId" IS NOT NULL;

  -- 2. Owner of every address still without one: the company of its first link.
  UPDATE "addresses" a
  SET "companyId" = first_link."companyId"
  FROM (
    SELECT DISTINCT ON (l."addressId") l."addressId", l."companyId"
    FROM kledg_address_links l
    ORDER BY l."addressId", l."priority", l."companyId"
  ) first_link
  WHERE a."id" = first_link."addressId" AND a."companyId" IS NULL;

  -- 3. One copy per other company linking the address, then repoint its links.
  INSERT INTO "addresses" ("id", "companyId", "street", "street2", "postalCode", "city", "country", "createdAt", "updatedAt")
  SELECT DISTINCT ON (l."addressId", l."companyId")
    'addr' || substr(md5(a."id" || '/' || l."companyId"), 1, 21),
    l."companyId", a."street", a."street2", a."postalCode", a."city", a."country", a."createdAt", CURRENT_TIMESTAMP
  FROM kledg_address_links l
  JOIN "addresses" a ON a."id" = l."addressId"
  WHERE a."companyId" <> l."companyId"
  ON CONFLICT ("id") DO NOTHING;

  UPDATE "companies" c
  SET "addressId" = 'addr' || substr(md5(a."id" || '/' || c."id"), 1, 21)
  FROM "addresses" a
  WHERE a."id" = c."addressId" AND a."companyId" <> c."id";

  UPDATE "companies" c
  SET "headquartersAddressId" = 'addr' || substr(md5(a."id" || '/' || c."id"), 1, 21)
  FROM "addresses" a
  WHERE a."id" = c."headquartersAddressId" AND a."companyId" <> c."id";

  UPDATE "establishments" e
  SET "addressId" = 'addr' || substr(md5(a."id" || '/' || e."companyId"), 1, 21)
  FROM "addresses" a
  WHERE a."id" = e."addressId" AND a."companyId" <> e."companyId";

  UPDATE "persons" p
  SET "addressId" = 'addr' || substr(md5(a."id" || '/' || l."companyId"), 1, 21)
  FROM kledg_address_links l
  JOIN "addresses" a ON a."id" = l."addressId"
  WHERE l."priority" = 4
    AND p."addressId" = l."addressId"
    AND a."companyId" <> l."companyId"
    AND l."companyId" = coalesce(
      p."companyId",
      (SELECT s."companyId" FROM "shareholders" s WHERE s."personId" = p."id" ORDER BY s."createdAt", s."id" LIMIT 1)
    );

  -- 4. Addresses no link uses (persons left without a company lose theirs).
  DELETE FROM "addresses" WHERE "companyId" IS NULL;
END
$$;

-- 5. Required, owned by a company, indexed.
ALTER TABLE "addresses" ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "addresses_companyId_idx" ON "addresses"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'addresses_companyId_fkey') THEN
    ALTER TABLE "addresses" ADD CONSTRAINT "addresses_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
