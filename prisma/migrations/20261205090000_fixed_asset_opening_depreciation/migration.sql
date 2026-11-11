-- Depreciation booked before Kledg followed a fixed asset (kledghq/kledg#30):
-- an asset acquired before the first fiscal year in Kledg carries the
-- accumulated depreciation of its earlier years, as of a day. Both or
-- neither, never negative.
ALTER TABLE "fixed_assets" ADD COLUMN "openingDepreciation" DECIMAL(15,2);
ALTER TABLE "fixed_assets" ADD COLUMN "openingDepreciationDate" TIMESTAMP(3);

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_opening_depreciation_pair"
  CHECK (("openingDepreciation" IS NULL) = ("openingDepreciationDate" IS NULL) AND ("openingDepreciation" IS NULL OR "openingDepreciation" >= 0));
