-- Budgets per fiscal year, docs/budget.md.
--
-- budgets: one per fiscal year, tied to the company of that fiscal year by a
-- composite foreign key on (fiscalYearId, companyId), so a budget can never
-- point at another company's fiscal year whatever the code path.
-- budget_lines: the class 6 or 7 accounts whose number starts with
-- accountPrefix, unique per budget.
-- budget_line_amounts: amount entered per calendar month (yyyy-mm).
-- budget_recurring_items: recurring amounts (monthly, quarterly, yearly)
-- expanded into the months of the fiscal year by lib/budgets/recurring.ts.
-- Amounts in Decimal(15, 2), handled in cents by the services.
--
-- Row level security (docs/rls.md): budgets carries the kledg_rls_* policies
-- on "companyId"; budget_lines is reached through its budget, amounts and
-- recurring items through their line (EXISTS on the parent, which applies
-- the parent's own policy).

-- CreateEnum
CREATE TYPE "BudgetFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "accountPrefix" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_line_amounts" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "budget_line_amounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_recurring_items" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "frequency" "BudgetFrequency" NOT NULL,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "budget_recurring_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_companyId_idx" ON "budgets"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_fiscalYearId_companyId_key" ON "budgets"("fiscalYearId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budgetId_accountPrefix_key" ON "budget_lines"("budgetId", "accountPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "budget_line_amounts_lineId_month_key" ON "budget_line_amounts"("lineId", "month");

-- CreateIndex
CREATE INDEX "budget_recurring_items_lineId_idx" ON "budget_recurring_items"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_id_companyId_key" ON "fiscal_years"("id", "companyId");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_amounts" ADD CONSTRAINT "budget_line_amounts_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "budget_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_recurring_items" ADD CONSTRAINT "budget_recurring_items_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "budget_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_accountPrefix_check"
  CHECK ("accountPrefix" ~ '^[67][0-9]{0,11}$');
ALTER TABLE "budget_line_amounts" ADD CONSTRAINT "budget_line_amounts_month_check"
  CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "budget_recurring_items" ADD CONSTRAINT "budget_recurring_items_months_check"
  CHECK ("startMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    AND ("endMonth" IS NULL OR ("endMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "endMonth" >= "startMonth")));

-- Row level security: company table
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "budgets" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "budgets" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "budgets" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "budgets" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- Row level security: through the parent
ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "budget_lines" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budgets" p WHERE p."id" = "budget_lines"."budgetId")));
CREATE POLICY "kledg_rls_insert" ON "budget_lines" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budgets" p WHERE p."id" = "budget_lines"."budgetId")));
CREATE POLICY "kledg_rls_update" ON "budget_lines" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budgets" p WHERE p."id" = "budget_lines"."budgetId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budgets" p WHERE p."id" = "budget_lines"."budgetId")));
CREATE POLICY "kledg_rls_delete" ON "budget_lines" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budgets" p WHERE p."id" = "budget_lines"."budgetId")));

ALTER TABLE "budget_line_amounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "budget_line_amounts" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_line_amounts"."lineId")));
CREATE POLICY "kledg_rls_insert" ON "budget_line_amounts" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_line_amounts"."lineId")));
CREATE POLICY "kledg_rls_update" ON "budget_line_amounts" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_line_amounts"."lineId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_line_amounts"."lineId")));
CREATE POLICY "kledg_rls_delete" ON "budget_line_amounts" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_line_amounts"."lineId")));

ALTER TABLE "budget_recurring_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "budget_recurring_items" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_recurring_items"."lineId")));
CREATE POLICY "kledg_rls_insert" ON "budget_recurring_items" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_recurring_items"."lineId")));
CREATE POLICY "kledg_rls_update" ON "budget_recurring_items" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_recurring_items"."lineId"))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_recurring_items"."lineId")));
CREATE POLICY "kledg_rls_delete" ON "budget_recurring_items" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR EXISTS (SELECT 1 FROM "budget_lines" p WHERE p."id" = "budget_recurring_items"."lineId")));
