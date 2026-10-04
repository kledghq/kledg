-- Fixed assets created by simple mode, docs/categories-simples.md.
--
-- When a user answers that a purchase is durable equipment, the confirmation
-- books it to the fixed asset account and creates the fixed asset in the
-- same transaction as the entry.
--
-- fixed_assets.acquisitionEntryId: the entry that booked the acquisition,
-- when Kledg created the asset with it. The asset goes with that entry:
-- deleting the draft (undoing the reconciliation, deleting the draft entry)
-- deletes the asset first, under the deletion rules of fixed assets. NO
-- ACTION refuses any other path that would leave the asset behind.
--
-- simple_mode_entries.fixedAssetId: the asset created with the entry, shown
-- to the accountant; null once the asset is deleted.
--
-- Row level security (docs/rls.md): new columns of company tables, covered
-- by their existing kledg_rls_* policies.

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "acquisitionEntryId" TEXT;

-- AlterTable
ALTER TABLE "simple_mode_entries" ADD COLUMN     "fixedAssetId" TEXT;

-- CreateIndex
CREATE INDEX "fixed_assets_acquisitionEntryId_idx" ON "fixed_assets"("acquisitionEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "simple_mode_entries_fixedAssetId_key" ON "simple_mode_entries"("fixedAssetId");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_acquisitionEntryId_fkey" FOREIGN KEY ("acquisitionEntryId") REFERENCES "accounting_entries"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
