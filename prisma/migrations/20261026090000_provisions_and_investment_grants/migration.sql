-- Provisions, impairments and investment grants followed from one closing
-- to the next, docs/provisions-et-subventions.md.
--
-- provisions: a provision for risks and charges (PCG art. 322-1 et seq.,
-- accounts 151 and 152) or an impairment (PCG art. 214-15 et seq., accounts
-- 29, 39, 49 and 59). Both are allowances adjusted at each closing.
-- provision_assessments: the balance required at the closing of one fiscal
-- year and the entry (draft, then validated by the user) of the dotation or
-- reprise reaching it; the movement is read from that entry.
-- investment_grants: a grant in equity (131) transferred to the result
-- (139 to 747) over the life of what it financed (PCG art. 312-1, CGI art.
-- 42 septies).
-- investment_grant_transfers: the entry of the share of one fiscal year.
--
-- Children are tied to the company of their parent and of their fiscal year
-- by composite foreign keys on (id, companyId), whatever the code path.
-- The rows of a closed fiscal year never change (PCG art. 1031-4), like its
-- entries: trigger kledg_lock_closed_year_adjustments, bypassed only by the
-- deletion of a whole company (kledg.closed_year_bypass).
-- Amounts in Decimal(15, 2), handled in cents by the services.
--
-- Row level security (docs/rls.md): the four tables are company tables, with
-- the kledg_rls_* policies on "companyId".

-- CreateEnum
CREATE TYPE "ProvisionCategory" AS ENUM ('RISK_CHARGE', 'FIXED_ASSET', 'INVENTORY', 'RECEIVABLE', 'SECURITY');

-- CreateEnum
CREATE TYPE "ProvisionNature" AS ENUM ('OPERATING', 'FINANCIAL', 'EXCEPTIONAL');

-- CreateEnum
CREATE TYPE "InvestmentGrantSpreading" AS ENUM ('ASSET', 'LINEAR', 'INALIENABILITY', 'TENTHS');

-- CreateTable
CREATE TABLE "provisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" "ProvisionCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "nature" "ProvisionNature" NOT NULL DEFAULT 'OPERATING',
    "taxDeductible" BOOLEAN NOT NULL DEFAULT true,
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "fixedAssetId" TEXT,
    "tiersCode" TEXT,
    "openedOn" TIMESTAMP(3) NOT NULL,
    "closedOn" TIMESTAMP(3),
    "carriedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provision_assessments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provisionId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currentValue" DECIMAL(15,2),
    "basis" TEXT,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "provision_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_grants" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grantor" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "grantedOn" TIMESTAMP(3) NOT NULL,
    "spreading" "InvestmentGrantSpreading" NOT NULL,
    "fixedAssetId" TEXT,
    "durationYears" INTEGER,
    "accountCode" TEXT NOT NULL DEFAULT '131',
    "transferAccountCode" TEXT NOT NULL DEFAULT '139',
    "incomeAccountCode" TEXT NOT NULL DEFAULT '747',
    "carriedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "investment_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_grant_transfers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "investment_grant_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provisions_companyId_idx" ON "provisions"("companyId");

-- CreateIndex
CREATE INDEX "provisions_fixedAssetId_idx" ON "provisions"("fixedAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "provisions_id_companyId_key" ON "provisions"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "provision_assessments_entryId_key" ON "provision_assessments"("entryId");

-- CreateIndex
CREATE INDEX "provision_assessments_companyId_idx" ON "provision_assessments"("companyId");

-- CreateIndex
CREATE INDEX "provision_assessments_fiscalYearId_idx" ON "provision_assessments"("fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "provision_assessments_provisionId_fiscalYearId_key" ON "provision_assessments"("provisionId", "fiscalYearId");

-- CreateIndex
CREATE INDEX "investment_grants_companyId_idx" ON "investment_grants"("companyId");

-- CreateIndex
CREATE INDEX "investment_grants_fixedAssetId_idx" ON "investment_grants"("fixedAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "investment_grants_id_companyId_key" ON "investment_grants"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "investment_grant_transfers_entryId_key" ON "investment_grant_transfers"("entryId");

-- CreateIndex
CREATE INDEX "investment_grant_transfers_companyId_idx" ON "investment_grant_transfers"("companyId");

-- CreateIndex
CREATE INDEX "investment_grant_transfers_fiscalYearId_idx" ON "investment_grant_transfers"("fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "investment_grant_transfers_grantId_fiscalYearId_key" ON "investment_grant_transfers"("grantId", "fiscalYearId");

-- AddForeignKey
ALTER TABLE "provisions" ADD CONSTRAINT "provisions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provisions" ADD CONSTRAINT "provisions_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision_assessments" ADD CONSTRAINT "provision_assessments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision_assessments" ADD CONSTRAINT "provision_assessments_provisionId_companyId_fkey" FOREIGN KEY ("provisionId", "companyId") REFERENCES "provisions"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision_assessments" ADD CONSTRAINT "provision_assessments_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision_assessments" ADD CONSTRAINT "provision_assessments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_grants" ADD CONSTRAINT "investment_grants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_grants" ADD CONSTRAINT "investment_grants_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_grant_transfers" ADD CONSTRAINT "investment_grant_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_grant_transfers" ADD CONSTRAINT "investment_grant_transfers_grantId_companyId_fkey" FOREIGN KEY ("grantId", "companyId") REFERENCES "investment_grants"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_grant_transfers" ADD CONSTRAINT "investment_grant_transfers_fiscalYearId_companyId_fkey" FOREIGN KEY ("fiscalYearId", "companyId") REFERENCES "fiscal_years"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_grant_transfers" ADD CONSTRAINT "investment_grant_transfers_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants of every code path
ALTER TABLE "provisions" ADD CONSTRAINT "provisions_values_check" CHECK (
  "label" <> '' AND "justification" <> '' AND "carriedAmount" >= 0
  AND ("closedOn" IS NULL OR "closedOn" >= "openedOn")
  AND (
    ("category" = 'RISK_CHARGE' AND ("accountCode" LIKE '151%' OR "accountCode" LIKE '152%'))
    OR ("category" = 'FIXED_ASSET' AND "accountCode" LIKE '29%')
    OR ("category" = 'INVENTORY' AND "accountCode" LIKE '39%')
    OR ("category" = 'RECEIVABLE' AND "accountCode" LIKE '49%')
    OR ("category" = 'SECURITY' AND "accountCode" LIKE '59%')
  )
);
ALTER TABLE "provision_assessments" ADD CONSTRAINT "provision_assessments_amount_check"
  CHECK ("amount" >= 0 AND ("currentValue" IS NULL OR "currentValue" >= 0));
ALTER TABLE "investment_grants" ADD CONSTRAINT "investment_grants_values_check" CHECK (
  "label" <> '' AND "amount" > 0 AND "carriedAmount" >= 0 AND "carriedAmount" <= "amount"
  AND ("spreading" <> 'ASSET' OR "fixedAssetId" IS NOT NULL)
  AND ("spreading" NOT IN ('LINEAR', 'INALIENABILITY') OR ("durationYears" IS NOT NULL AND "durationYears" BETWEEN 1 AND 100))
  AND "accountCode" LIKE '13%' AND "accountCode" NOT LIKE '139%'
  AND "transferAccountCode" LIKE '139%'
  AND "incomeAccountCode" LIKE '7%'
);

-- The rows of a closed fiscal year are as closed: no insert, update or delete
CREATE OR REPLACE FUNCTION kledg_lock_closed_year_adjustments() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM kledg_assert_fiscal_year_open(OLD."fiscalYearId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM kledg_assert_fiscal_year_open(NEW."fiscalYearId");
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "provision_assessments_closed_year_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "provision_assessments"
FOR EACH ROW EXECUTE FUNCTION kledg_lock_closed_year_adjustments();

CREATE TRIGGER "investment_grant_transfers_closed_year_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "investment_grant_transfers"
FOR EACH ROW EXECUTE FUNCTION kledg_lock_closed_year_adjustments();

-- Row level security: company table
ALTER TABLE "provisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "provisions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "provisions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "provisions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "provisions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- Row level security: company table
ALTER TABLE "provision_assessments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "provision_assessments" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "provision_assessments" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "provision_assessments" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "provision_assessments" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- Row level security: company table
ALTER TABLE "investment_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "investment_grants" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "investment_grants" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "investment_grants" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "investment_grants" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

-- Row level security: company table
ALTER TABLE "investment_grant_transfers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "investment_grant_transfers" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "investment_grant_transfers" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "investment_grant_transfers" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "investment_grant_transfers" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
