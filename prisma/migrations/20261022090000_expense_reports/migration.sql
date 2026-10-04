-- Expense reports (notes de frais), docs/notes-de-frais.md.
--
-- expense_claimants: who the company reimburses (employee, dirigeant,
-- associé), with the account and auxiliary number credited by the reports.
-- expense_reports and expense_lines: the reports and their expenses or
-- mileage trips, amounts in Decimal(15, 2) computed by the server in cents.
-- expense_category_rules: keyword to category mapping of a company.
--
-- Row level security (docs/rls.md): the three company tables carry the
-- kledg_rls_* policies on "companyId"; expense_lines is reached through its
-- report (EXISTS on the parent, which applies the parent's own policy).

-- CreateEnum
CREATE TYPE "ExpenseClaimantKind" AS ENUM ('EMPLOYEE', 'DIRIGEANT', 'ASSOCIE');

-- CreateEnum
CREATE TYPE "ExpenseReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VALIDATED');

-- CreateEnum
CREATE TYPE "ExpenseLineKind" AS ENUM ('EXPENSE', 'MILEAGE');

-- CreateEnum
CREATE TYPE "ExpenseReceiptKind" AS ENUM ('NONE', 'RECEIPT', 'INVOICE');

-- CreateTable
CREATE TABLE "expense_claimants" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ExpenseClaimantKind" NOT NULL,
    "name" TEXT NOT NULL,
    "personId" TEXT,
    "userId" TEXT,
    "accountCode" TEXT,
    "auxiliaryAccountNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claimants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ExpenseReportStatus" NOT NULL DEFAULT 'DRAFT',
    "totalInclTax" DECIMAL(15,2) NOT NULL,
    "recoverableVat" DECIMAL(15,2) NOT NULL,
    "totalExpense" DECIMAL(15,2) NOT NULL,
    "createdById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "returnNote" TEXT,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_lines" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "ExpenseLineKind" NOT NULL DEFAULT 'EXPENSE',
    "date" TIMESTAMP(3) NOT NULL,
    "supplierName" TEXT,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "accountCode" TEXT,
    "amountInclTax" DECIMAL(15,2) NOT NULL,
    "vatRateBp" INTEGER NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "recoverableVat" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receiptKind" "ExpenseReceiptKind" NOT NULL DEFAULT 'NONE',
    "receiptAttachmentId" TEXT,
    "receiptReference" TEXT,
    "vehicleType" TEXT,
    "fiscalPower" INTEGER,
    "electric" BOOLEAN NOT NULL DEFAULT false,
    "distanceKm" INTEGER,
    "priorDistanceKm" INTEGER,
    "scaleYear" INTEGER,

    CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_category_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "accountCode" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_claimants_personId_idx" ON "expense_claimants"("personId");

-- CreateIndex
CREATE INDEX "expense_claimants_userId_idx" ON "expense_claimants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claimants_companyId_auxiliaryAccountNumber_key" ON "expense_claimants"("companyId", "auxiliaryAccountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claimants_companyId_userId_key" ON "expense_claimants"("companyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claimants_companyId_personId_key" ON "expense_claimants"("companyId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_reports_entryId_key" ON "expense_reports"("entryId");

-- CreateIndex
CREATE INDEX "expense_reports_companyId_status_idx" ON "expense_reports"("companyId", "status");

-- CreateIndex
CREATE INDEX "expense_reports_claimantId_idx" ON "expense_reports"("claimantId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_reports_companyId_number_key" ON "expense_reports"("companyId", "number");

-- CreateIndex
CREATE INDEX "expense_lines_reportId_idx" ON "expense_lines"("reportId");

-- CreateIndex
CREATE INDEX "expense_lines_receiptAttachmentId_idx" ON "expense_lines"("receiptAttachmentId");

-- CreateIndex
CREATE INDEX "expense_category_rules_companyId_idx" ON "expense_category_rules"("companyId");

-- AddForeignKey
ALTER TABLE "expense_claimants" ADD CONSTRAINT "expense_claimants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claimants" ADD CONSTRAINT "expense_claimants_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claimants" ADD CONSTRAINT "expense_claimants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "expense_claimants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "expense_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_receiptAttachmentId_fkey" FOREIGN KEY ("receiptAttachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_category_rules" ADD CONSTRAINT "expense_category_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Amounts: never negative, the VAT within the amount, the recoverable part
-- within the VAT, and a report's total equal to its charges plus its VAT.
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_amounts_check"
  CHECK ("amountInclTax" >= 0 AND "vatAmount" >= 0 AND "vatAmount" <= "amountInclTax"
     AND "recoverableVat" >= 0 AND "recoverableVat" <= "vatAmount"
     AND "vatRateBp" >= 0 AND "vatRateBp" <= 10000);
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_mileage_check"
  CHECK ("kind" <> 'MILEAGE' OR ("distanceKm" > 0 AND "vatAmount" = 0 AND "vehicleType" IS NOT NULL AND "scaleYear" IS NOT NULL));
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_totals_check"
  CHECK ("totalInclTax" >= 0 AND "recoverableVat" >= 0 AND "totalInclTax" = "totalExpense" + "recoverableVat");
ALTER TABLE "expense_reports" ADD CONSTRAINT "expense_reports_period_check"
  CHECK ("periodStart" <= "periodEnd");
ALTER TABLE "expense_claimants" ADD CONSTRAINT "expense_claimants_account_check"
  CHECK ("accountCode" IS NULL OR "accountCode" ~ '^(421|425|455|467)[0-9A-Z]*$');

-- expense_claimants
ALTER TABLE "expense_claimants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "expense_claimants" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "expense_claimants" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "expense_claimants" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "expense_claimants" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- expense_reports
ALTER TABLE "expense_reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "expense_reports" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "expense_reports" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "expense_reports" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "expense_reports" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- expense_category_rules
ALTER TABLE "expense_category_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "expense_category_rules" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "expense_category_rules" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "expense_category_rules" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "expense_category_rules" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- expense_lines (through the report)
ALTER TABLE "expense_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "expense_lines" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "expense_reports" p WHERE p."id" = "expense_lines"."reportId")));
CREATE POLICY "kledg_rls_insert" ON "expense_lines" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "expense_reports" p WHERE p."id" = "expense_lines"."reportId")));
CREATE POLICY "kledg_rls_update" ON "expense_lines" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "expense_reports" p WHERE p."id" = "expense_lines"."reportId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "expense_reports" p WHERE p."id" = "expense_lines"."reportId")));
CREATE POLICY "kledg_rls_delete" ON "expense_lines" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "expense_reports" p WHERE p."id" = "expense_lines"."reportId")));
