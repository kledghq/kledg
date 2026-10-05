-- Training organisations, partial VAT deduction and taxe sur les salaires
-- (docs/organisme-de-formation.md; lib/vat-deduction, lib/training-report,
-- lib/payroll-tax, lib/invoices/vat-exemptions.ts).
--
-- companies.partialVatDeduction: the company makes taxable and exempt
-- operations and deducts its VAT by the coefficient de déduction (CGI ann. II
-- art. 205 to 207). Default false: nothing changes for existing companies.
-- companies.vatExemptionMention: the mention of exempt training invoices
-- (CGI ann. II art. 242 nonies A, I, 10°); null: the default text.
-- invoice_lines.vatExemption: legal basis of an exempt 0 % line.
-- tiers.trainingOrigin: frame C line of the BPF for a customer.
--
-- vat_deduction_years: what the books cannot tell about the coefficient of a
-- calendar year (estimate of a first year, coefficient d'assujettissement,
-- VAT borne). revenue_account_settings: VAT treatment and BPF origin of a
-- revenue account. training_reports: the frames of the bilan pédagogique et
-- financier entered by hand, per closed fiscal year. payroll_tax_years: the
-- individual remunerations of the taxe sur les salaires of a year.
--
-- Row level security (docs/rls.md): four company tables, the kledg_rls_*
-- policies on "companyId".

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "partialVatDeduction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "vatExemptionMention" TEXT;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN "vatExemption" TEXT;

-- AlterTable
ALTER TABLE "tiers" ADD COLUMN "trainingOrigin" TEXT;

-- CreateTable
CREATE TABLE "vat_deduction_years" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "estimatedTaxationPercent" INTEGER,
    "assujettissementPercent" INTEGER NOT NULL DEFAULT 100,
    "incurredVat" DECIMAL(15,2),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_deduction_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_account_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "vatTreatment" TEXT,
    "trainingOrigin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_account_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_years" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_tax_years_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vat_deduction_years_companyId_year_key" ON "vat_deduction_years"("companyId", "year");
CREATE INDEX "vat_deduction_years_companyId_idx" ON "vat_deduction_years"("companyId");
CREATE UNIQUE INDEX "revenue_account_settings_companyId_accountCode_key" ON "revenue_account_settings"("companyId", "accountCode");
CREATE INDEX "revenue_account_settings_companyId_idx" ON "revenue_account_settings"("companyId");
CREATE UNIQUE INDEX "training_reports_companyId_fiscalYearId_key" ON "training_reports"("companyId", "fiscalYearId");
CREATE INDEX "training_reports_companyId_idx" ON "training_reports"("companyId");
CREATE INDEX "training_reports_fiscalYearId_idx" ON "training_reports"("fiscalYearId");
CREATE UNIQUE INDEX "payroll_tax_years_companyId_year_key" ON "payroll_tax_years"("companyId", "year");
CREATE INDEX "payroll_tax_years_companyId_idx" ON "payroll_tax_years"("companyId");

-- AddForeignKey
ALTER TABLE "vat_deduction_years" ADD CONSTRAINT "vat_deduction_years_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenue_account_settings" ADD CONSTRAINT "revenue_account_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_tax_years" ADD CONSTRAINT "payroll_tax_years_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path.
-- An exemption only on a 0 % line, with a known legal basis.
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_vat_exemption_check"
  CHECK ("vatExemption" IS NULL OR ("vatExemption" IN ('training') AND "vatRateBp" = 0));
ALTER TABLE "companies" ADD CONSTRAINT "companies_vat_exemption_mention_check"
  CHECK ("vatExemptionMention" IS NULL OR length("vatExemptionMention") BETWEEN 1 AND 300);
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_training_origin_check"
  CHECK ("trainingOrigin" IS NULL OR "trainingOrigin" ~ '^[a-z0-9-]{1,20}$');
-- Coefficients are whole percents (art. 206, III, 3°); years of the books.
ALTER TABLE "vat_deduction_years" ADD CONSTRAINT "vat_deduction_years_year_check" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "vat_deduction_years" ADD CONSTRAINT "vat_deduction_years_percent_check"
  CHECK (("estimatedTaxationPercent" IS NULL OR "estimatedTaxationPercent" BETWEEN 0 AND 100) AND "assujettissementPercent" BETWEEN 0 AND 100);
ALTER TABLE "vat_deduction_years" ADD CONSTRAINT "vat_deduction_years_incurred_check" CHECK ("incurredVat" IS NULL OR "incurredVat" >= 0);
-- A revenue setting is a class 7 code and says something.
ALTER TABLE "revenue_account_settings" ADD CONSTRAINT "revenue_account_settings_code_check" CHECK ("accountCode" ~ '^7[0-9A-Za-z]{0,19}$');
ALTER TABLE "revenue_account_settings" ADD CONSTRAINT "revenue_account_settings_treatment_check"
  CHECK ("vatTreatment" IS NULL OR "vatTreatment" IN ('taxable', 'exempt', 'excluded'));
ALTER TABLE "revenue_account_settings" ADD CONSTRAINT "revenue_account_settings_origin_check"
  CHECK ("trainingOrigin" IS NULL OR "trainingOrigin" ~ '^[a-z0-9-]{1,20}$');
ALTER TABLE "revenue_account_settings" ADD CONSTRAINT "revenue_account_settings_content_check"
  CHECK ("vatTreatment" IS NOT NULL OR "trainingOrigin" IS NOT NULL);
ALTER TABLE "training_reports" ADD CONSTRAINT "training_reports_data_check" CHECK (jsonb_typeof("data") = 'object');
ALTER TABLE "payroll_tax_years" ADD CONSTRAINT "payroll_tax_years_year_check" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "payroll_tax_years" ADD CONSTRAINT "payroll_tax_years_data_check" CHECK (jsonb_typeof("data") = 'object');

-- Row level security: company tables
ALTER TABLE "vat_deduction_years" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "vat_deduction_years" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "vat_deduction_years" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "vat_deduction_years" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "vat_deduction_years" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "revenue_account_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "revenue_account_settings" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "revenue_account_settings" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "revenue_account_settings" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "revenue_account_settings" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "training_reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "training_reports" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "training_reports" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "training_reports" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "training_reports" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "payroll_tax_years" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "payroll_tax_years" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "payroll_tax_years" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "payroll_tax_years" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "payroll_tax_years" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
