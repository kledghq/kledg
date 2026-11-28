-- Receipts found by Kledg (lib/receipts/read, lib/receipts/suggest-receipts.service.ts).
-- fieldsReadFrom: the amount and date of a staged receipt were read by Kledg
-- in its file (an e-invoice, a PDF's text, the file name) and are waiting
-- for the user's confirmation; null once confirmed or typed.
-- suggestedTransactionId: the transaction a re-matching after a bank sync
-- found for the receipt, attached only on the user's click.

ALTER TABLE "staged_receipts" ADD COLUMN "fieldsReadFrom" TEXT,
ADD COLUMN "suggestedAt" TIMESTAMP(3),
ADD COLUMN "suggestedTransactionId" TEXT;

ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_fields_read_from_check" CHECK ("fieldsReadFrom" IS NULL OR "fieldsReadFrom" IN ('e-invoice', 'pdf', 'file-name'));

-- CreateIndex
CREATE INDEX "staged_receipts_suggestedTransactionId_idx" ON "staged_receipts"("suggestedTransactionId");

-- AddForeignKey
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_suggestedTransactionId_fkey" FOREIGN KEY ("suggestedTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
