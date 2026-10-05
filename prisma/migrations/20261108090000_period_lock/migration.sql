-- Period closing (clôture des périodes), PCG art. 1031-4 (règlement ANC
-- n° 2014-03 as amended by n° 2022-06): "une procédure de clôture destinée
-- à figer la chronologie et à garantir l'intangibilité des enregistrements
-- est mise en œuvre au plus tard avant l'expiration de la période suivante".
-- An operation dated in a closed period is booked on the first day of the
-- open period, with its real date stated (FEC PieceDate).
--
-- Additive: three nullable columns, functions and triggers; no backfill.
--
-- fiscal_years."periodLockedThrough" is the last closed day of the year:
-- - no entry dated on or before it can be created, moved into it or
--   validated (validated entries already there stay as they are; lettering
--   and the bank link are not part of the entry);
-- - it only moves forward, stays before the last day of the year (closing
--   the last period is closing the year) and cannot be set while a draft of
--   the year is dated in the period to close.
-- Deleting a whole company runs with kledg.closed_year_bypass (see
-- migration 20261004090000_fiscal_year_closing_lock). Errors carry the
-- marker KLEDG_PERIOD_LOCKED, mapped to a 409 by the application
-- (lib/accounting/errors.ts).

-- AlterTable
ALTER TABLE "fiscal_years" ADD COLUMN "periodLockedThrough" TIMESTAMP(3);
ALTER TABLE "fiscal_years" ADD COLUMN "periodLockedAt" TIMESTAMP(3);
ALTER TABLE "fiscal_years" ADD COLUMN "periodLockedById" TEXT;

CREATE OR REPLACE FUNCTION kledg_assert_period_open(fiscal_year_id TEXT, entry_date TIMESTAMP(3)) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  locked_through TIMESTAMP(3);
BEGIN
  IF fiscal_year_id IS NULL OR entry_date IS NULL OR kledg_closed_year_bypass() THEN
    RETURN;
  END IF;
  SELECT "periodLockedThrough" INTO locked_through FROM "fiscal_years" WHERE "id" = fiscal_year_id;
  IF locked_through IS NOT NULL AND entry_date::date <= locked_through::date THEN
    RAISE EXCEPTION 'KLEDG_PERIOD_LOCKED: la période est clôturée jusqu''au % : datez l''écriture du % au plus tôt et indiquez sa date réelle en date de pièce',
      to_char(locked_through, 'DD/MM/YYYY'), to_char(locked_through + interval '1 day', 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION kledg_lock_closed_period_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM kledg_assert_period_open(NEW."fiscalYearId", NEW."date");
  ELSIF NEW."date" IS DISTINCT FROM OLD."date"
     OR NEW."fiscalYearId" IS DISTINCT FROM OLD."fiscalYearId"
     OR (OLD."status" = 'draft' AND NEW."status" = 'validated') THEN
    PERFORM kledg_assert_period_open(NEW."fiscalYearId", NEW."date");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "accounting_entries_period_lock"
BEFORE INSERT OR UPDATE ON "accounting_entries"
FOR EACH ROW EXECUTE FUNCTION kledg_lock_closed_period_entries();

CREATE OR REPLACE FUNCTION kledg_guard_period_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF kledg_closed_year_bypass() THEN
    RETURN NEW;
  END IF;
  IF NEW."periodLockedThrough" IS DISTINCT FROM OLD."periodLockedThrough" THEN
    IF NEW."periodLockedThrough" IS NULL OR (OLD."periodLockedThrough" IS NOT NULL AND NEW."periodLockedThrough" < OLD."periodLockedThrough") THEN
      RAISE EXCEPTION 'KLEDG_PERIOD_LOCKED: une période clôturée ne se rouvre pas' USING ERRCODE = 'P0001';
    END IF;
    IF OLD."isClosed" THEN
      RAISE EXCEPTION 'KLEDG_PERIOD_LOCKED: l''exercice est clôturé' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "accounting_entries"
      WHERE "fiscalYearId" = NEW."id" AND "status" = 'draft' AND "date"::date <= NEW."periodLockedThrough"::date
    ) THEN
      RAISE EXCEPTION 'KLEDG_PERIOD_LOCKED: des écritures en brouillon sont datées dans la période : validez-les ou supprimez-les d''abord' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- Checked on a date change of the year too: the closed day stays inside it.
  IF NEW."periodLockedThrough" IS NOT NULL
     AND (NEW."periodLockedThrough"::date < NEW."startDate"::date OR NEW."periodLockedThrough"::date >= NEW."endDate"::date) THEN
    RAISE EXCEPTION 'KLEDG_PERIOD_LOCKED: la fin de la période doit être dans l''exercice, avant son dernier jour' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fiscal_years_period_lock"
BEFORE UPDATE OF "periodLockedThrough", "startDate", "endDate" ON "fiscal_years"
FOR EACH ROW EXECUTE FUNCTION kledg_guard_period_lock();
