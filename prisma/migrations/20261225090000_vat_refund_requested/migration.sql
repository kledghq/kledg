-- Refund of a CA3 VAT credit requested on form 3519 (#173): line 26 of the
-- 3310-CA3-SD, the rest of the credit carried on line 27 (notice
-- 3310-NOT-CA3-SD n° 50449#29). The settlement entry books it on 44583
-- "Remboursement de taxes sur le chiffre d'affaires demandé" instead of
-- 44567 (lib/vat-returns/settlement.ts).
ALTER TABLE "vat_return_filings" ADD COLUMN "refundAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Never negative, only with a credit (no amount due), and only on a CA3.
ALTER TABLE "vat_return_filings" ADD CONSTRAINT "vat_return_filings_refund_check"
  CHECK ("refundAmount" >= 0 AND ("refundAmount" = 0 OR ("amountDue" = 0 AND "form" = 'CA3')));
