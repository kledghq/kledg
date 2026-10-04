-- Definitive accounting entries and complete FEC data.
--
-- 1. Columns (additive, nullable): validation date (FEC ValidDate), supporting
--    document date (PieceDate), link from a reversing entry (contre-passation)
--    to the entry it cancels, and the FEC line fields Kledg did not keep
--    (auxiliary account, lettrage, foreign currency amount), LPF art. A47 A-1.
-- 2. Backfill: entries validated before this migration get their last update
--    time as validation date (best known value).
-- 3. Triggers: a validated entry is definitive (PCG art. 1031-3: "une
--    procedure de validation, qui interdit toute modification ou suppression
--    de l'enregistrement"). Only lettrage and technical columns may change.
--    Validation itself requires a definitive number and balanced lines.
--    Cascades from a parent row (deleting a whole company) are not blocked.

-- AlterTable
ALTER TABLE "accounting_entries" ADD COLUMN "validatedAt" TIMESTAMP(3);
ALTER TABLE "accounting_entries" ADD COLUMN "pieceDate" TIMESTAMP(3);
ALTER TABLE "accounting_entries" ADD COLUMN "reversalOfId" TEXT;

-- AlterTable
ALTER TABLE "entry_lines" ADD COLUMN "auxiliaryAccountNumber" TEXT;
ALTER TABLE "entry_lines" ADD COLUMN "auxiliaryAccountLabel" TEXT;
ALTER TABLE "entry_lines" ADD COLUMN "letteringCode" TEXT;
ALTER TABLE "entry_lines" ADD COLUMN "letteringDate" TIMESTAMP(3);
ALTER TABLE "entry_lines" ADD COLUMN "currencyAmount" DECIMAL(15,2);
ALTER TABLE "entry_lines" ADD COLUMN "currencyCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_reversalOfId_key" ON "accounting_entries"("reversalOfId");

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill
UPDATE "accounting_entries" SET "validatedAt" = "updatedAt" WHERE "status" = 'validated' AND "validatedAt" IS NULL;

-- Entries
CREATE OR REPLACE FUNCTION kledg_guard_accounting_entry() RETURNS trigger AS $$
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
    ) THEN
      RAISE EXCEPTION 'KLEDG_IMMUTABLE_ENTRY: écriture validée n° % : elle ne peut pas être modifiée', OLD."entryNumber"
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- Validation (draft -> validated): definitive number and balanced lines.
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_entries_guard"
  BEFORE UPDATE OR DELETE ON "accounting_entries"
  FOR EACH ROW EXECUTE FUNCTION kledg_guard_accounting_entry();

-- Entry lines
CREATE OR REPLACE FUNCTION kledg_guard_entry_line() RETURNS trigger AS $$
DECLARE
  entry_status text;
  entry_number text;
BEGIN
  -- Cascades: renumbering at validation, deleting a draft or a whole company.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."accountingEntryId" IS DISTINCT FROM NEW."accountingEntryId" THEN
    IF EXISTS (
      SELECT 1 FROM "accounting_entries"
      WHERE "id" IN (OLD."accountingEntryId", NEW."accountingEntryId") AND "status" = 'validated'
    ) THEN
      RAISE EXCEPTION 'KLEDG_IMMUTABLE_ENTRY: une ligne d''écriture validée ne peut pas être déplacée' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT "status", "entryNumber" INTO entry_status, entry_number FROM "accounting_entries" WHERE "id" = OLD."accountingEntryId";
  ELSE
    SELECT "status", "entryNumber" INTO entry_status, entry_number FROM "accounting_entries" WHERE "id" = NEW."accountingEntryId";
  END IF;

  IF entry_status IS DISTINCT FROM 'validated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."accountId" IS NOT DISTINCT FROM OLD."accountId"
    AND NEW."accountFiscalYearId" IS NOT DISTINCT FROM OLD."accountFiscalYearId"
    AND NEW."accountingEntryNumber" IS NOT DISTINCT FROM OLD."accountingEntryNumber"
    AND NEW."debit" IS NOT DISTINCT FROM OLD."debit"
    AND NEW."credit" IS NOT DISTINCT FROM OLD."credit"
    AND NEW."description" IS NOT DISTINCT FROM OLD."description"
    AND NEW."auxiliaryAccountNumber" IS NOT DISTINCT FROM OLD."auxiliaryAccountNumber"
    AND NEW."auxiliaryAccountLabel" IS NOT DISTINCT FROM OLD."auxiliaryAccountLabel"
    AND NEW."currencyAmount" IS NOT DISTINCT FROM OLD."currencyAmount"
    AND NEW."currencyCode" IS NOT DISTINCT FROM OLD."currencyCode"
  THEN
    -- Lettrage (letteringCode, letteringDate) is not part of the entry.
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'KLEDG_IMMUTABLE_ENTRY: écriture validée n° % : ses lignes ne peuvent être ni ajoutées, ni modifiées, ni supprimées', entry_number
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "entry_lines_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "entry_lines"
  FOR EACH ROW EXECUTE FUNCTION kledg_guard_entry_line();
