-- VAT returns prepared by Kledg and filed by the user on impots.gouv.fr,
-- docs/declarations-tva.md (lib/vat-returns).
--
-- One row per period of a company: the day the user filed the return and
-- the amounts declared (amount paid, credit carried forward). Kledg never
-- files a return; the row drives the checks of the next period (payment
-- booked on 4455, credit carried forward on 44567).
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- CreateTable
CREATE TABLE "vat_return_filings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "filedOn" TIMESTAMP(3) NOT NULL,
    "amountDue" DECIMAL(15,2) NOT NULL,
    "creditAmount" DECIMAL(15,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_return_filings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vat_return_filings_companyId_periodKey_key" ON "vat_return_filings"("companyId", "periodKey");

-- CreateIndex
CREATE INDEX "vat_return_filings_companyId_idx" ON "vat_return_filings"("companyId");

-- AddForeignKey
ALTER TABLE "vat_return_filings" ADD CONSTRAINT "vat_return_filings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path: a known form, a period key of that form,
-- a period in order, amounts never negative and never both set.
ALTER TABLE "vat_return_filings" ADD CONSTRAINT "vat_return_filings_form_check"
  CHECK (("form" = 'CA3' AND "periodKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2]|T[1-4])$') OR ("form" = 'CA12' AND "periodKey" ~ '^[0-9]{4}$'));
ALTER TABLE "vat_return_filings" ADD CONSTRAINT "vat_return_filings_period_check"
  CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "vat_return_filings" ADD CONSTRAINT "vat_return_filings_amounts_check"
  CHECK ("amountDue" >= 0 AND "creditAmount" >= 0 AND ("amountDue" = 0 OR "creditAmount" = 0));

-- Row level security: company table
ALTER TABLE "vat_return_filings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "vat_return_filings" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "vat_return_filings" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "vat_return_filings" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "vat_return_filings" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
