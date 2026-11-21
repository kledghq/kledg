-- Ledger integrity (#147): a content hash on every validated entry, and
-- append-only seals of a fiscal year's validated entries written at each
-- period lock and at the closing. They make a change made in the database
-- outside Kledg detectable (lib/accounting/integrity/verify-ledger.service.ts):
-- the database refuses changes to validated entries through its triggers,
-- the hashes show whether rows were changed past them.

-- Canonical content of an entry and its lines: what a validated entry
-- states (PCG art. 1031-3). Lines in id order; amounts as stored. The two
-- helper functions run as their caller (not SECURITY DEFINER): under row
-- level security the application only hashes and seals the rows it sees;
-- the entry guard, a definer trigger, calls them as the owner.
CREATE OR REPLACE FUNCTION kledg_entry_hash(entry_id text, entry_number text, entry_date timestamp, journal_id text,
  company_id text, fiscal_year_id text, description text, reference text, piece_date timestamp, reversal_of_id text)
RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to(
    concat_ws('|', entry_id, entry_number, to_char(entry_date, 'YYYY-MM-DD'), journal_id, company_id, fiscal_year_id,
      coalesce(description, ''), coalesce(reference, ''), coalesce(to_char(piece_date, 'YYYY-MM-DD'), ''), coalesce(reversal_of_id, ''))
    || E'\n' ||
    coalesce((
      SELECT string_agg(concat_ws('|', l."id", l."accountId", l."debit"::text, l."credit"::text,
               coalesce(l."auxiliaryAccountNumber", ''), coalesce(l."description", '')), E'\n' ORDER BY l."id")
      FROM "entry_lines" l WHERE l."accountingEntryId" = entry_id
    ), ''),
  'UTF8')), 'hex')
$$;

ALTER TABLE "accounting_entries" ADD COLUMN "contentHash" TEXT;
-- When the database hashed the entry (its own clock, whatever validatedAt says: an imported FEC keeps its ValidDate).
ALTER TABLE "accounting_entries" ADD COLUMN "hashedAt" TIMESTAMP(3);

-- The entry guard of migration 20261003180000, with the content hash:
-- written at validation, never changed after it.
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

-- Entries validated before this migration: their hash as they stand today.
SELECT set_config('kledg.closed_year_bypass', 'on', true);
UPDATE "accounting_entries" SET "contentHash" = kledg_entry_hash("id", "entryNumber", "date", "journalId", "companyId",
  "fiscalYearId", "description", "reference", "pieceDate", "reversalOfId"), "hashedAt" = now()
WHERE "status" = 'validated' AND "contentHash" IS NULL;
SELECT set_config('kledg.closed_year_bypass', 'off', true);

-- Seals: the validated entries of a fiscal year at one moment, in validation order.
CREATE TABLE "ledger_seals" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "throughDay" TIMESTAMP(3),
  "entryCount" INTEGER NOT NULL,
  "lastHashedAt" TIMESTAMP(3),
  "sealHash" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_seals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ledger_seals_companyId_idx" ON "ledger_seals"("companyId");
CREATE INDEX "ledger_seals_fiscalYearId_createdAt_idx" ON "ledger_seals"("fiscalYearId", "createdAt");
ALTER TABLE "ledger_seals" ADD CONSTRAINT "ledger_seals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_seals" ADD CONSTRAINT "ledger_seals_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_seals" ADD CONSTRAINT "ledger_seals_reason_check" CHECK ("reason" IN ('period_lock', 'closing'));
ALTER TABLE "ledger_seals" ADD CONSTRAINT "ledger_seals_hash_check" CHECK ("sealHash" ~ '^[0-9a-f]{64}$');

-- Seal of the validated entries of a fiscal year hashed up to `through` (all of them when null), in hashing order.
CREATE OR REPLACE FUNCTION kledg_ledger_seal(fiscal_year_id text, through timestamp)
RETURNS TABLE (entry_count integer, last_hashed_at timestamp, seal_hash text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT count(*)::integer, max(e."hashedAt"),
    encode(sha256(convert_to(coalesce(string_agg(e."id" || ':' || coalesce(e."contentHash", ''), E'\n' ORDER BY e."hashedAt", e."id"), ''), 'UTF8')), 'hex')
  FROM "accounting_entries" e
  WHERE e."fiscalYearId" = fiscal_year_id AND e."status" = 'validated' AND (through IS NULL OR e."hashedAt" <= through)
$$;

-- Append only: a seal is never changed or deleted, except with its company or fiscal year (cascade) or a purge.
CREATE OR REPLACE FUNCTION kledg_guard_ledger_seal() RETURNS trigger
SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR coalesce(current_setting('kledg.company_purge', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'KLEDG_IMMUTABLE_SEAL: un scellement du grand livre ne se modifie ni ne se supprime' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_seals_guard"
  BEFORE UPDATE OR DELETE ON "ledger_seals"
  FOR EACH ROW EXECUTE FUNCTION kledg_guard_ledger_seal();

-- Row level security: company table
ALTER TABLE "ledger_seals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "ledger_seals" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "ledger_seals" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "ledger_seals" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "ledger_seals" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
