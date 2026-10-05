-- Impôt sur les sociétés prepared by Kledg and filed by the user on
-- impots.gouv.fr, docs/impot-societes.md (lib/corporate-tax).
--
-- One row per fiscal year of a company: what the books cannot tell (the
-- answers to the reduced rate questions of CGI art. 219, I, b, the deficits
-- carried forward of art. 209, I, the manual lines, the acomptes paid) and,
-- once filed, the amounts declared, which drive the acomptes of the next
-- fiscal year (CGI art. 1668). Kledg never files a return.
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- CreateTable
CREATE TABLE "corporate_tax_returns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "capitalPaidUp" BOOLEAN,
    "naturalPersons75" BOOLEAN,
    "deficitsOpening" DECIMAL(15,2),
    "manualLines" JSONB NOT NULL DEFAULT '[]',
    "acomptesPaid" JSONB NOT NULL DEFAULT '[]',
    "filedOn" TIMESTAMP(3),
    "resultBeforeDeficits" DECIMAL(15,2),
    "deficitsImputed" DECIMAL(15,2),
    "corporateTax" DECIMAL(15,2),
    "reducedRate" BOOLEAN,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_tax_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corporate_tax_returns_fiscalYearId_companyId_key" ON "corporate_tax_returns"("fiscalYearId", "companyId");

-- CreateIndex
CREATE INDEX "corporate_tax_returns_companyId_idx" ON "corporate_tax_returns"("companyId");

-- AddForeignKey
ALTER TABLE "corporate_tax_returns" ADD CONSTRAINT "corporate_tax_returns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the fiscal year is always one of the row's company.
ALTER TABLE "corporate_tax_returns" ADD CONSTRAINT "corporate_tax_returns_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path: amounts never negative where the forms
-- forbid it, the filing recorded whole or not at all, JSON lists.
ALTER TABLE "corporate_tax_returns" ADD CONSTRAINT "corporate_tax_returns_deficits_check"
  CHECK ("deficitsOpening" IS NULL OR "deficitsOpening" >= 0);
ALTER TABLE "corporate_tax_returns" ADD CONSTRAINT "corporate_tax_returns_filing_check"
  CHECK (
    ("filedOn" IS NULL AND "resultBeforeDeficits" IS NULL AND "deficitsImputed" IS NULL AND "corporateTax" IS NULL AND "reducedRate" IS NULL)
    OR ("filedOn" IS NOT NULL AND "resultBeforeDeficits" IS NOT NULL AND "deficitsImputed" IS NOT NULL AND "corporateTax" IS NOT NULL AND "reducedRate" IS NOT NULL
        AND "deficitsImputed" >= 0 AND "corporateTax" >= 0)
  );
ALTER TABLE "corporate_tax_returns" ADD CONSTRAINT "corporate_tax_returns_lists_check"
  CHECK (jsonb_typeof("manualLines") = 'array' AND jsonb_typeof("acomptesPaid") = 'array');

-- Row level security: company table
ALTER TABLE "corporate_tax_returns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "corporate_tax_returns" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "corporate_tax_returns" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "corporate_tax_returns" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "corporate_tax_returns" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
