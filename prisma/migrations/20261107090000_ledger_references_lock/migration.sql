-- Journals and accounts referenced by the books. Additive: functions and
-- triggers only, no column, no backfill.
--
-- An entry stores its journal and the accounts of its lines by id. The FEC
-- of a year gives back, for each line, JournalCode, JournalLib, CompteNum
-- and CompteLib (LPF art. A47 A-1), so renaming a journal or an account
-- rewrites every entry that uses it. A validated entry is definitive (PCG
-- art. 1031-3) and a closed fiscal year never changes (PCG art. 1031-4):
-- - the code of a journal holding a validated entry never changes;
-- - the code of an account carrying a line of a validated entry never
--   changes;
-- - the label of an account of a closed fiscal year never changes, nor the
--   label of a journal holding an entry of a closed fiscal year.
-- Labels of an open year may still be corrected (a typo): the entries keep
-- their meaning, and the FEC is produced from the year's final state.
-- Errors carry the marker KLEDG_LEDGER_REFERENCE, mapped to a 409 by the
-- application (lib/accounting/errors.ts). Deleting a whole company is not
-- concerned (no update of these columns).

CREATE OR REPLACE FUNCTION kledg_guard_journal_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" AND EXISTS (
    SELECT 1 FROM "accounting_entries" WHERE "journalId" = OLD."id" AND "status" = 'validated'
  ) THEN
    RAISE EXCEPTION 'KLEDG_LEDGER_REFERENCE: le journal % porte des écritures validées : son code ne peut plus changer', OLD."code"
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."label" IS DISTINCT FROM OLD."label" AND NOT kledg_closed_year_bypass() AND EXISTS (
    SELECT 1 FROM "accounting_entries" e JOIN "fiscal_years" f ON f."id" = e."fiscalYearId"
    WHERE e."journalId" = OLD."id" AND f."isClosed"
  ) THEN
    RAISE EXCEPTION 'KLEDG_LEDGER_REFERENCE: le journal % porte des écritures d''un exercice clôturé : son libellé ne peut plus changer', OLD."code"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "journals_reference_lock"
BEFORE UPDATE OF "code", "label" ON "journals"
FOR EACH ROW EXECUTE FUNCTION kledg_guard_journal_reference();

CREATE OR REPLACE FUNCTION kledg_guard_account_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" AND EXISTS (
    SELECT 1 FROM "entry_lines" l JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    WHERE l."accountId" = OLD."id" AND e."status" = 'validated'
  ) THEN
    RAISE EXCEPTION 'KLEDG_LEDGER_REFERENCE: le compte % porte des écritures validées : son numéro ne peut plus changer', OLD."code"
      USING ERRCODE = 'P0001';
  END IF;
  IF (NEW."code" IS DISTINCT FROM OLD."code" OR NEW."label" IS DISTINCT FROM OLD."label")
     AND NOT kledg_closed_year_bypass()
     AND EXISTS (SELECT 1 FROM "fiscal_years" WHERE "id" = OLD."fiscalYearId" AND "isClosed") THEN
    RAISE EXCEPTION 'KLEDG_LEDGER_REFERENCE: le compte % appartient à un exercice clôturé : il ne peut plus changer', OLD."code"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "accounts_reference_lock"
BEFORE UPDATE OF "code", "label" ON "accounts"
FOR EACH ROW EXECUTE FUNCTION kledg_guard_account_reference();
