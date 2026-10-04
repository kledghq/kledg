-- Fiscal year closing: when and by whom a year was closed, and a lock that
-- keeps the books of a closed year as they were closed, whatever code path
-- writes to the database. Additive: two nullable columns, functions and
-- triggers; no backfill.
--
-- Once a fiscal year is closed (fiscal_years."isClosed"):
-- - no accounting entry of that year can be created or deleted, and its
--   accounting content (number, date, journal, year, description,
--   reference, status) cannot change; the link to a bank transaction and
--   updatedAt can;
-- - no entry line of that year can be created, deleted or changed
--   (account, amounts, description, entry);
-- - the year cannot be reopened, have its dates changed or be deleted.
-- Operations allowed on a closed year (deleting a whole company) run in a
-- transaction after: SELECT set_config('kledg.closed_year_bypass', 'on', true)
-- Errors carry the marker KLEDG_FISCAL_YEAR_CLOSED, mapped to a 409 by the
-- application (lib/accounting/errors.ts).

-- AlterTable
ALTER TABLE "fiscal_years" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "fiscal_years" ADD COLUMN "closedById" TEXT;

CREATE OR REPLACE FUNCTION kledg_closed_year_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('kledg.closed_year_bypass', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION kledg_assert_fiscal_year_open(fiscal_year_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF fiscal_year_id IS NULL OR kledg_closed_year_bypass() THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "fiscal_years" WHERE "id" = fiscal_year_id AND "isClosed") THEN
    RAISE EXCEPTION 'KLEDG_FISCAL_YEAR_CLOSED: the fiscal year % is closed', fiscal_year_id;
  END IF;
END;
$$;

-- Accounting content of an entry and of an entry line. Read through jsonb so
-- that a column added or removed later does not break the trigger: a new
-- accounting column must be added to these lists.
CREATE OR REPLACE FUNCTION kledg_entry_content(entry jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    entry -> 'entryNumber', entry -> 'date', entry -> 'journalId', entry -> 'companyId',
    entry -> 'fiscalYearId', entry -> 'description', entry -> 'reference', entry -> 'status'
  )
$$;

CREATE OR REPLACE FUNCTION kledg_entry_line_content(line jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    line -> 'accountingEntryId', line -> 'accountingEntryNumber', line -> 'accountId',
    line -> 'accountFiscalYearId', line -> 'debit', line -> 'credit', line -> 'description'
  )
$$;

CREATE OR REPLACE FUNCTION kledg_lock_closed_year_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM kledg_assert_fiscal_year_open(NEW."fiscalYearId");
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM kledg_assert_fiscal_year_open(OLD."fiscalYearId");
    RETURN OLD;
  END IF;
  IF kledg_entry_content(to_jsonb(NEW)) IS DISTINCT FROM kledg_entry_content(to_jsonb(OLD)) THEN
    PERFORM kledg_assert_fiscal_year_open(OLD."fiscalYearId");
    PERFORM kledg_assert_fiscal_year_open(NEW."fiscalYearId");
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION kledg_lock_closed_year_entry_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_year TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF TG_OP = 'DELETE'
       OR kledg_entry_line_content(to_jsonb(NEW)) IS DISTINCT FROM kledg_entry_line_content(to_jsonb(OLD)) THEN
      SELECT "fiscalYearId" INTO entry_year FROM "accounting_entries" WHERE "id" = OLD."accountingEntryId";
      PERFORM kledg_assert_fiscal_year_open(entry_year);
      PERFORM kledg_assert_fiscal_year_open(OLD."accountFiscalYearId");
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF TG_OP = 'INSERT'
       OR kledg_entry_line_content(to_jsonb(NEW)) IS DISTINCT FROM kledg_entry_line_content(to_jsonb(OLD)) THEN
      SELECT "fiscalYearId" INTO entry_year FROM "accounting_entries" WHERE "id" = NEW."accountingEntryId";
      PERFORM kledg_assert_fiscal_year_open(entry_year);
      PERFORM kledg_assert_fiscal_year_open(NEW."accountFiscalYearId");
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION kledg_lock_closed_fiscal_years() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT OLD."isClosed" OR kledg_closed_year_bypass() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'KLEDG_FISCAL_YEAR_CLOSED: the fiscal year % is closed and cannot be deleted', OLD."id";
  END IF;
  IF NOT NEW."isClosed"
     OR NEW."startDate" IS DISTINCT FROM OLD."startDate"
     OR NEW."endDate" IS DISTINCT FROM OLD."endDate"
     OR NEW."year" IS DISTINCT FROM OLD."year"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId" THEN
    RAISE EXCEPTION 'KLEDG_FISCAL_YEAR_CLOSED: the fiscal year % is closed and cannot be reopened or changed', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "accounting_entries_closed_year_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "accounting_entries"
FOR EACH ROW EXECUTE FUNCTION kledg_lock_closed_year_entries();

CREATE TRIGGER "entry_lines_closed_year_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "entry_lines"
FOR EACH ROW EXECUTE FUNCTION kledg_lock_closed_year_entry_lines();

CREATE TRIGGER "fiscal_years_closed_lock"
BEFORE UPDATE OR DELETE ON "fiscal_years"
FOR EACH ROW EXECUTE FUNCTION kledg_lock_closed_fiscal_years();
