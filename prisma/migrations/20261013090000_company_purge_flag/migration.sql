-- Throwaway companies: an instance that provisions short-lived companies
-- (the public demo, kledg-demo) must be able to delete them with their
-- books. Kledg itself never sets the flag below: its own deletion path
-- (lib/companies/archive-company.service.ts) keeps refusing a company with
-- books. Additive: the guard function is replaced, the trigger is unchanged.
--
-- kledg_guard_company_delete lets a DELETE through when the transaction ran
--   SELECT set_config('kledg.company_purge', 'on', true)
-- (transaction scoped, like kledg.closed_year_bypass of migration
-- 20261004090000_fiscal_year_closing_lock, which such a deletion also sets).

CREATE OR REPLACE FUNCTION kledg_guard_company_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('kledg.company_purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM "accounting_entries" WHERE "companyId" = OLD."id" AND "status" = 'validated')
     OR EXISTS (SELECT 1 FROM "fiscal_years" WHERE "companyId" = OLD."id" AND ("isClosed" OR "closedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'KLEDG_COMPANY_HAS_BOOKS: a company with validated entries or a closed fiscal year is kept 10 years; archive it instead'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
