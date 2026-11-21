-- #161: refuse an accounting entry inserted directly as validated. Every
-- path of the application creates a draft and validates it (entry services,
-- FEC import), so the validation checks of kledg_guard_accounting_entry
-- (definitive number, balanced lines, content hash, #147) always run.

CREATE OR REPLACE FUNCTION kledg_guard_accounting_entry() RETURNS trigger
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  line_count integer;
  total_debit numeric;
  total_credit numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'validated' AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'KLEDG_IMMUTABLE_ENTRY: écriture validée n° % : elle ne peut pas être supprimée', OLD."entryNumber"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."status" NOT IN ('draft', 'validated') THEN
    RAISE EXCEPTION 'KLEDG_INVALID_ENTRY: statut d''écriture inconnu %', NEW."status" USING ERRCODE = 'P0001';
  END IF;

  -- An entry is created as a draft, then validated (#161): an insert as validated would skip the
  -- definitive number, balance and content hash checks of the validation below.
  IF TG_OP = 'INSERT' AND NEW."status" = 'validated' THEN
    RAISE EXCEPTION 'KLEDG_INVALID_ENTRY: une écriture se crée en brouillon, puis se valide' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'validated' THEN
    IF pg_trigger_depth() = 1 AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."entryNumber" IS DISTINCT FROM OLD."entryNumber"
      OR NEW."date" IS DISTINCT FROM OLD."date"
      OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
      OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
      OR NEW."fiscalYearId" IS DISTINCT FROM OLD."fiscalYearId"
      OR NEW."description" IS DISTINCT FROM OLD."description"
      OR NEW."reference" IS DISTINCT FROM OLD."reference"
      OR NEW."validatedAt" IS DISTINCT FROM OLD."validatedAt"
      OR NEW."pieceDate" IS DISTINCT FROM OLD."pieceDate"
      OR NEW."reversalOfId" IS DISTINCT FROM OLD."reversalOfId"
      OR (OLD."contentHash" IS NOT NULL AND (NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR NEW."hashedAt" IS DISTINCT FROM OLD."hashedAt"))
    ) THEN
      RAISE EXCEPTION 'KLEDG_IMMUTABLE_ENTRY: écriture validée n° % : elle ne peut pas être modifiée', OLD."entryNumber"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- Validation (draft -> validated): definitive number, balanced lines, content hash.
  IF TG_OP = 'UPDATE' AND OLD."status" = 'draft' AND NEW."status" = 'validated' THEN
    IF NEW."entryNumber" LIKE 'BR-%' THEN
      RAISE EXCEPTION 'KLEDG_INVALID_ENTRY: une écriture validée doit avoir un numéro définitif' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*), coalesce(sum("debit"), 0), coalesce(sum("credit"), 0)
      INTO line_count, total_debit, total_credit
      FROM "entry_lines" WHERE "accountingEntryId" = NEW."id";
    IF line_count < 2 OR total_debit <> total_credit THEN
      RAISE EXCEPTION 'KLEDG_INVALID_ENTRY: écriture n° % non équilibrée ou incomplète (% ligne(s), débit %, crédit %)',
        NEW."entryNumber", line_count, total_debit, total_credit USING ERRCODE = 'P0001';
    END IF;
    IF NEW."validatedAt" IS NULL THEN
      NEW."validatedAt" := now();
    END IF;
    NEW."contentHash" := kledg_entry_hash(NEW."id", NEW."entryNumber", NEW."date", NEW."journalId", NEW."companyId",
      NEW."fiscalYearId", NEW."description", NEW."reference", NEW."pieceDate", NEW."reversalOfId");
    NEW."hashedAt" := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "accounting_entries_guard" ON "accounting_entries";
CREATE TRIGGER "accounting_entries_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "accounting_entries"
  FOR EACH ROW EXECUTE FUNCTION kledg_guard_accounting_entry();
