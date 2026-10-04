-- Company archiving, and companies that hold books can no longer be deleted.
-- Additive: two nullable columns, one index, one trigger function, one
-- trigger.
--
-- The books (validated entries, closed fiscal years) are kept 10 years
-- (Code de commerce art. L123-22). Deleting a company cascades to its
-- entries and fiscal years, so a company with a validated entry or a closed
-- fiscal year is never deleted: KLEDG_COMPANY_HAS_BOOKS is raised for every
-- code path. Such a company is archived instead ("archivedAt" set): read
-- only, hidden from the lists, restorable by an instance administrator
-- (lib/companies/archive-company.service.ts).
-- Test: app/api/__tests__/company-deletion.db.test.ts.

ALTER TABLE "companies" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "archivedById" TEXT;

CREATE INDEX "companies_archivedAt_idx" ON "companies"("archivedAt");

CREATE OR REPLACE FUNCTION kledg_guard_company_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "accounting_entries" WHERE "companyId" = OLD."id" AND "status" = 'validated')
     OR EXISTS (SELECT 1 FROM "fiscal_years" WHERE "companyId" = OLD."id" AND ("isClosed" OR "closedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'KLEDG_COMPANY_HAS_BOOKS: a company with validated entries or a closed fiscal year is kept 10 years; archive it instead'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "companies_keep_books"
BEFORE DELETE ON "companies"
FOR EACH ROW EXECUTE FUNCTION kledg_guard_company_delete();
