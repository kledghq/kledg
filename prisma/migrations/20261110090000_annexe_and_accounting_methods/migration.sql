-- Annexe des comptes annuels and register of accounting methods
-- (docs/annexe-et-2054.md, lib/annexe).
--
-- accounting_methods: the main methods the company retains where the PCG
-- leaves a choice (PCG art. 121-5, 831-1 3°).
-- accounting_changes: changes of regulation or method, changes of estimate
-- and corrections of errors of a fiscal year (PCG art. 122-1 to 122-6), with
-- their impact and treatment and the draft catch-up entry Kledg prepares.
-- annexe_notes: one row per fiscal year, what only the user knows for the
-- annexe (commitments, events after the closing...), validated by
-- AnnexeDetailsSchema in lib/annexe/schemas.ts.
--
-- No closed-year lock: the annexe of a year is written after its closing,
-- and a change booked by hand before the closing is still documented then.
-- The entry of a change is only prepared in an open year (service check and
-- the entry triggers).
--
-- Row level security (docs/rls.md): three company tables, the kledg_rls_*
-- policies on "companyId".

-- CreateEnum
CREATE TYPE "AccountingChangeKind" AS ENUM ('REGULATION_CHANGE', 'METHOD_CHANGE', 'ESTIMATE_CHANGE', 'ERROR_CORRECTION');

-- CreateEnum
CREATE TYPE "AccountingChangeTreatment" AS ENUM ('EQUITY', 'RESULT', 'PROSPECTIVE');

-- CreateTable
CREATE TABLE "accounting_methods" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "adoptedOn" TIMESTAMP(3),
    "referenceMethod" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_changes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "kind" "AccountingChangeKind" NOT NULL,
    "treatment" "AccountingChangeTreatment" NOT NULL,
    "methodId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxEffect" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "accountCode" TEXT,
    "entryDate" TIMESTAMP(3),
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annexe_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annexe_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_methods_companyId_idx" ON "accounting_methods"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_changes_entryId_key" ON "accounting_changes"("entryId");

-- CreateIndex
CREATE INDEX "accounting_changes_companyId_idx" ON "accounting_changes"("companyId");

-- CreateIndex
CREATE INDEX "accounting_changes_fiscalYearId_idx" ON "accounting_changes"("fiscalYearId");

-- CreateIndex
CREATE INDEX "accounting_changes_methodId_idx" ON "accounting_changes"("methodId");

-- CreateIndex
CREATE UNIQUE INDEX "annexe_notes_fiscalYearId_companyId_key" ON "annexe_notes"("fiscalYearId", "companyId");

-- CreateIndex
CREATE INDEX "annexe_notes_companyId_idx" ON "annexe_notes"("companyId");

-- AddForeignKey
ALTER TABLE "accounting_methods" ADD CONSTRAINT "accounting_methods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_changes" ADD CONSTRAINT "accounting_changes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_changes" ADD CONSTRAINT "accounting_changes_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_changes" ADD CONSTRAINT "accounting_changes_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "accounting_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_changes" ADD CONSTRAINT "accounting_changes_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annexe_notes" ADD CONSTRAINT "annexe_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annexe_notes" ADD CONSTRAINT "annexe_notes_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path
ALTER TABLE "accounting_changes" ADD CONSTRAINT "accounting_changes_tax_check" CHECK ("taxEffect" >= 0);
-- A change of estimate is prospective (PCG art. 122-5): it has no catch-up entry
ALTER TABLE "accounting_changes" ADD CONSTRAINT "accounting_changes_estimate_check"
  CHECK ("kind" <> 'ESTIMATE_CHANGE' OR "treatment" = 'PROSPECTIVE');
ALTER TABLE "annexe_notes" ADD CONSTRAINT "annexe_notes_details_check" CHECK (jsonb_typeof("details") = 'object');

-- Row level security: company tables
ALTER TABLE "accounting_methods" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "accounting_methods" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "accounting_methods" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "accounting_methods" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "accounting_methods" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "accounting_changes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "accounting_changes" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "accounting_changes" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "accounting_changes" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "accounting_changes" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "annexe_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "annexe_notes" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "annexe_notes" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "annexe_notes" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "annexe_notes" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
