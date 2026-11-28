-- Receipt email address of a company (lib/receipts/inbound): receipts
-- sent to <token>@<KLEDG_RECEIPTS_EMAIL_DOMAIN> are staged like an upload.
-- The token is random (whoever knows the address can send receipts) and
-- can be changed; staged receipts get the source "email".

ALTER TABLE "companies" ADD COLUMN "receiptInboxChangedAt" TIMESTAMP(3),
ADD COLUMN "receiptInboxToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "companies_receiptInboxToken_key" ON "companies"("receiptInboxToken");

ALTER TABLE "companies" ADD CONSTRAINT "companies_receipt_inbox_token_check" CHECK ("receiptInboxToken" IS NULL OR "receiptInboxToken" ~ '^[a-z0-9]{16}$');

ALTER TABLE "staged_receipts" DROP CONSTRAINT "staged_receipts_source_check";
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_source_check" CHECK ("source" IN ('view', 'file_param', 'base64', 'app', 'email'));
