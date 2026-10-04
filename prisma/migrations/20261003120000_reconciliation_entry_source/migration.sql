-- Entries created by bank reconciliation remember their transaction: undoing
-- the reconciliation deletes only those drafts, and the unique index allows a
-- single generated entry per transaction. Additive: nullable column, no backfill.

-- AlterTable
ALTER TABLE "accounting_entries" ADD COLUMN "sourceBankTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entries_sourceBankTransactionId_key" ON "accounting_entries"("sourceBankTransactionId");

-- AddForeignKey
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_sourceBankTransactionId_fkey" FOREIGN KEY ("sourceBankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
