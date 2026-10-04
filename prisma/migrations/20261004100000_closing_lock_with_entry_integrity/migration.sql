-- Closed-year lock (20261004090000) alongside the entry integrity rules
-- (20261003180000). Additive: functions replaced, foreign keys re-created
-- with the same columns; no data changes.
--
-- 1. The accounting content compared by the closed-year triggers includes
--    the columns added for the FEC: validation date, document date and
--    reversal link of an entry; auxiliary account and foreign currency
--    amount of a line. Lettrage (letteringCode, letteringDate) is not part
--    of the entry and may still change, as on a validated entry.
-- 2. Foreign keys from entries, entry lines and fixed assets to accounts,
--    journals, fiscal years and reversed entries were ON DELETE RESTRICT,
--    checked row by row: deleting a whole company failed as soon as it had
--    entries, depending on the order of the cascades. They become ON DELETE
--    NO ACTION, DEFERRABLE INITIALLY IMMEDIATE: they still refuse deleting
--    an account, journal or fiscal year in use, immediately, and the
--    company deletion defers them to the end of its transaction
--    (SET CONSTRAINTS ALL DEFERRED), once the cascades are done.

CREATE OR REPLACE FUNCTION kledg_entry_content(entry jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    entry -> 'entryNumber', entry -> 'date', entry -> 'journalId', entry -> 'companyId',
    entry -> 'fiscalYearId', entry -> 'description', entry -> 'reference', entry -> 'status',
    entry -> 'validatedAt', entry -> 'pieceDate', entry -> 'reversalOfId'
  )
$$;

CREATE OR REPLACE FUNCTION kledg_entry_line_content(line jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    line -> 'accountingEntryId', line -> 'accountingEntryNumber', line -> 'accountId',
    line -> 'accountFiscalYearId', line -> 'debit', line -> 'credit', line -> 'description',
    line -> 'auxiliaryAccountNumber', line -> 'auxiliaryAccountLabel',
    line -> 'currencyAmount', line -> 'currencyCode'
  )
$$;

ALTER TABLE "accounting_entries" DROP CONSTRAINT "accounting_entries_journalId_fkey";
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounting_entries" DROP CONSTRAINT "accounting_entries_fiscalYearId_fkey";
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounting_entries" DROP CONSTRAINT "accounting_entries_reversalOfId_fkey";
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "accounting_entries"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "entry_lines" DROP CONSTRAINT "entry_lines_accountId_accountFiscalYearId_fkey";
ALTER TABLE "entry_lines" ADD CONSTRAINT "entry_lines_accountId_accountFiscalYearId_fkey" FOREIGN KEY ("accountId", "accountFiscalYearId") REFERENCES "accounts"("id", "fiscalYearId") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_assetAccountId_fkey";
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_depreciationAccountId_fkey";
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciationAccountId_fkey" FOREIGN KEY ("depreciationAccountId") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "fixed_assets" DROP CONSTRAINT "fixed_assets_expenseAccountId_fkey";
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
