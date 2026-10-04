-- Management fees (frais de gestion of a holding animatrice to its
-- subsidiaries), docs/frais-de-gestion.md.
--
-- management_fee_conventions: the agreement of a holding (companyId) with
-- some of its subsidiaries: pricing (cost plus a mark-up, or a fixed amount),
-- cost pool accounts, allocation key, VAT rate, accounts and invoice series.
-- management_fee_subsidiaries: the subsidiaries party to it, with their custom
-- share and their dates in the convention.
-- management_fee_billings: the fee of one subsidiary for one period as
-- invoiced, linked to the holding's sales invoice and to the draft purchase
-- invoice proposed to the subsidiary. Unique per convention, subsidiary and
-- period, so a retried generation creates nothing twice.
-- CreateEnum
CREATE TYPE "ManagementFeePricing" AS ENUM ('COST_PLUS', 'FIXED');

-- CreateEnum
CREATE TYPE "ManagementFeeAllocationKey" AS ENUM ('EQUAL', 'REVENUE', 'CUSTOM');

-- CreateTable
CREATE TABLE "management_fee_conventions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "pricing" "ManagementFeePricing" NOT NULL DEFAULT 'COST_PLUS',
    "markupBp" INTEGER NOT NULL DEFAULT 500,
    "costShareBp" INTEGER NOT NULL DEFAULT 10000,
    "costAccountPrefixes" TEXT[],
    "excludedAccountPrefixes" TEXT[],
    "fixedAmount" DECIMAL(15,2),
    "allocationKey" "ManagementFeeAllocationKey" NOT NULL DEFAULT 'EQUAL',
    "vatRateBp" INTEGER NOT NULL DEFAULT 2000,
    "revenueAccountCode" TEXT NOT NULL DEFAULT '706',
    "expenseAccountCode" TEXT NOT NULL DEFAULT '6226',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'FG',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_fee_conventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_fee_subsidiaries" (
    "id" TEXT NOT NULL,
    "conventionId" TEXT NOT NULL,
    "subsidiaryId" TEXT NOT NULL,
    "sharePercentBp" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "management_fee_subsidiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_fee_billings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conventionId" TEXT NOT NULL,
    "subsidiaryId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountExclTax" DECIMAL(15,2) NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "vatAmount" DECIMAL(15,2) NOT NULL,
    "amountInclTax" DECIMAL(15,2) NOT NULL,
    "details" JSONB NOT NULL,
    "salesInvoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_fee_billings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "management_fee_conventions_companyId_idx" ON "management_fee_conventions"("companyId");

-- CreateIndex
CREATE INDEX "management_fee_subsidiaries_subsidiaryId_idx" ON "management_fee_subsidiaries"("subsidiaryId");

-- CreateIndex
CREATE UNIQUE INDEX "management_fee_subsidiaries_conventionId_subsidiaryId_key" ON "management_fee_subsidiaries"("conventionId", "subsidiaryId");

-- CreateIndex
CREATE UNIQUE INDEX "management_fee_billings_salesInvoiceId_key" ON "management_fee_billings"("salesInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "management_fee_billings_purchaseInvoiceId_key" ON "management_fee_billings"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "management_fee_billings_companyId_idx" ON "management_fee_billings"("companyId");

-- CreateIndex
CREATE INDEX "management_fee_billings_subsidiaryId_idx" ON "management_fee_billings"("subsidiaryId");

-- CreateIndex
CREATE UNIQUE INDEX "management_fee_billings_conventionId_subsidiaryId_periodSta_key" ON "management_fee_billings"("conventionId", "subsidiaryId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "management_fee_conventions" ADD CONSTRAINT "management_fee_conventions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_fee_subsidiaries" ADD CONSTRAINT "management_fee_subsidiaries_conventionId_fkey" FOREIGN KEY ("conventionId") REFERENCES "management_fee_conventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_fee_subsidiaries" ADD CONSTRAINT "management_fee_subsidiaries_subsidiaryId_fkey" FOREIGN KEY ("subsidiaryId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- NO ACTION: a convention with billings is never deleted (checked at the end
-- of the statement, so deleting the holding still cascades to both).
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_conventionId_fkey" FOREIGN KEY ("conventionId") REFERENCES "management_fee_conventions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_subsidiaryId_fkey" FOREIGN KEY ("subsidiaryId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants that hold for every code path (lib/management-fees checks them
-- first with a French message).
ALTER TABLE "management_fee_conventions" ADD CONSTRAINT "management_fee_conventions_rates_check"
  CHECK ("markupBp" BETWEEN 0 AND 10000 AND "costShareBp" BETWEEN 1 AND 10000 AND "vatRateBp" BETWEEN 0 AND 10000);
ALTER TABLE "management_fee_conventions" ADD CONSTRAINT "management_fee_conventions_fixed_check"
  CHECK ("pricing" <> 'FIXED' OR ("fixedAmount" IS NOT NULL AND "fixedAmount" > 0));
ALTER TABLE "management_fee_conventions" ADD CONSTRAINT "management_fee_conventions_dates_check"
  CHECK ("endDate" IS NULL OR "startDate" <= "endDate");
ALTER TABLE "management_fee_subsidiaries" ADD CONSTRAINT "management_fee_subsidiaries_share_check"
  CHECK ("sharePercentBp" IS NULL OR "sharePercentBp" BETWEEN 0 AND 10000);
ALTER TABLE "management_fee_subsidiaries" ADD CONSTRAINT "management_fee_subsidiaries_dates_check"
  CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate");
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_amounts_check"
  CHECK ("amountExclTax" > 0 AND "vatAmount" >= 0 AND "amountInclTax" = "amountExclTax" + "vatAmount");
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_period_check"
  CHECK ("periodStart" <= "periodEnd");
-- A holding is never its own subsidiary.
ALTER TABLE "management_fee_billings" ADD CONSTRAINT "management_fee_billings_parties_check"
  CHECK ("companyId" <> "subsidiaryId");

-- Row level security (docs/rls.md): conventions and billings belong to the
-- holding (companyId); the subsidiaries of a convention are reached through
-- it (EXISTS on the parent, which applies the parent's own policy). A
-- subsidiary's own rows (its purchase invoices) stay under its own policies:
-- the holding's context never reads or writes them.
ALTER TABLE "management_fee_conventions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "management_fee_conventions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "management_fee_conventions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "management_fee_conventions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "management_fee_conventions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "management_fee_billings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "management_fee_billings" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "management_fee_billings" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "management_fee_billings" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "management_fee_billings" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "management_fee_subsidiaries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "management_fee_subsidiaries" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "management_fee_conventions" p WHERE p."id" = "management_fee_subsidiaries"."conventionId")));
CREATE POLICY "kledg_rls_insert" ON "management_fee_subsidiaries" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "management_fee_conventions" p WHERE p."id" = "management_fee_subsidiaries"."conventionId")));
CREATE POLICY "kledg_rls_update" ON "management_fee_subsidiaries" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "management_fee_conventions" p WHERE p."id" = "management_fee_subsidiaries"."conventionId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "management_fee_conventions" p WHERE p."id" = "management_fee_subsidiaries"."conventionId")));
CREATE POLICY "kledg_rls_delete" ON "management_fee_subsidiaries" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "management_fee_conventions" p WHERE p."id" = "management_fee_subsidiaries"."conventionId")));
