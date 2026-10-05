-- Saved simulations of the "Rémunération et dividendes" simulator,
-- docs/remuneration-dividendes.md (lib/remuneration).
--
-- One row per named scenario of a fiscal year: the inputs of the
-- simulation (result before the director's pay, status, household,
-- split), the rules year used and the main figures when saved. An
-- indicative simulation, never advice; nothing here is booked.
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- CreateTable
CREATE TABLE "remuneration_scenarios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "rulesYear" INTEGER NOT NULL,
    "remunerationCost" DECIMAL(15,2) NOT NULL,
    "dividends" DECIMAL(15,2) NOT NULL,
    "netIncome" DECIMAL(15,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remuneration_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "remuneration_scenarios_fiscalYearId_companyId_name_key" ON "remuneration_scenarios"("fiscalYearId", "companyId", "name");

-- CreateIndex
CREATE INDEX "remuneration_scenarios_companyId_idx" ON "remuneration_scenarios"("companyId");

-- AddForeignKey
ALTER TABLE "remuneration_scenarios" ADD CONSTRAINT "remuneration_scenarios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the fiscal year is always one of the row's company.
ALTER TABLE "remuneration_scenarios" ADD CONSTRAINT "remuneration_scenarios_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path: a readable name, amounts never negative,
-- the inputs an object.
ALTER TABLE "remuneration_scenarios" ADD CONSTRAINT "remuneration_scenarios_name_check"
  CHECK (char_length(btrim("name")) BETWEEN 1 AND 80);
ALTER TABLE "remuneration_scenarios" ADD CONSTRAINT "remuneration_scenarios_amounts_check"
  CHECK ("remunerationCost" >= 0 AND "dividends" >= 0);
ALTER TABLE "remuneration_scenarios" ADD CONSTRAINT "remuneration_scenarios_inputs_check"
  CHECK (jsonb_typeof("inputs") = 'object');

-- Row level security: company table
ALTER TABLE "remuneration_scenarios" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "remuneration_scenarios" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "remuneration_scenarios" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "remuneration_scenarios" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "remuneration_scenarios" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
