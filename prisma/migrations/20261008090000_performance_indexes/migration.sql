-- Composite indexes for the hot paths measured with scripts/bench (large
-- profile: 5 years of 15,000 entries and 20,000 bank transactions per company,
-- 21 companies). Additive only.

-- Entries of a company over a date range (journal report, dashboard, entry
-- lists by period): the single-column date index mixed every company's rows.
CREATE INDEX "accounting_entries_companyId_date_idx" ON "accounting_entries"("companyId", "date");

-- Transactions of a bank account over a period (transactions and
-- reconciliation pages, rules engine run on the open year, statement import
-- duplicate window): one range scan instead of a BitmapAnd of three indexes.
CREATE INDEX "bank_transactions_bankAccountId_date_idx" ON "bank_transactions"("bankAccountId", "date");
