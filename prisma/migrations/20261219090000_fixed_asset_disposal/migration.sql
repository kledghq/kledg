-- Disposal of a fixed asset (lib/fixed-assets/record-disposal.service.ts):
-- the kind of exit, the sale price excluding VAT and the exit entry Kledg
-- prepared as a draft. Deleting that entry only unlinks it.

ALTER TABLE "fixed_assets" ADD COLUMN "disposalKind" TEXT;
ALTER TABLE "fixed_assets" ADD COLUMN "disposalPrice" DECIMAL(15,2);
ALTER TABLE "fixed_assets" ADD COLUMN "disposalEntryId" TEXT;

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_kind_check" CHECK ("disposalKind" IS NULL OR "disposalKind" IN ('sale', 'scrap', 'destruction'));
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_price_check" CHECK ("disposalPrice" IS NULL OR "disposalPrice" >= 0);

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposalEntryId_fkey" FOREIGN KEY ("disposalEntryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "fixed_assets_disposalEntryId_idx" ON "fixed_assets"("disposalEntryId");
