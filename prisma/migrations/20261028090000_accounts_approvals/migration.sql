-- Approval of the annual accounts and filing with the greffe,
-- docs/approbation-des-comptes.md (lib/approval).
--
-- One row per fiscal year: what the user told Kledg about the decision
-- (meeting, officers, attendance, votes, choices on the result, size
-- category, management report texts), validated by ApprovalDetailsSchema
-- in lib/approval/schemas.ts. approvedOn and filedOn are copied out of the
-- JSON for the deadline calendar (lib/deadlines). The composite foreign key
-- keeps the fiscal year in the row's company.
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- CreateTable
CREATE TABLE "accounts_approvals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "approvedOn" TIMESTAMP(3),
    "filedOn" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_approvals_fiscalYearId_companyId_key" ON "accounts_approvals"("fiscalYearId", "companyId");

-- CreateIndex
CREATE INDEX "accounts_approvals_companyId_idx" ON "accounts_approvals"("companyId");

-- AddForeignKey
ALTER TABLE "accounts_approvals" ADD CONSTRAINT "accounts_approvals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts_approvals" ADD CONSTRAINT "accounts_approvals_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path: a JSON object, filing never before approval
ALTER TABLE "accounts_approvals" ADD CONSTRAINT "accounts_approvals_details_check"
  CHECK (jsonb_typeof("details") = 'object');
ALTER TABLE "accounts_approvals" ADD CONSTRAINT "accounts_approvals_dates_check"
  CHECK ("filedOn" IS NULL OR "approvedOn" IS NULL OR "filedOn" >= "approvedOn");

-- Row level security: company table
ALTER TABLE "accounts_approvals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "accounts_approvals" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "accounts_approvals" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "accounts_approvals" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "accounts_approvals" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
