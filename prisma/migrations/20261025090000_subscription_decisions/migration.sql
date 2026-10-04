-- Decisions on detected subscriptions, docs/abonnements.md.
--
-- Recurring payments are detected from the bank lines at each read
-- (lib/subscriptions/detect.ts) and never stored. This table keeps only what
-- a user decided about one: confirmed or ignored, and the budget line it was
-- last added to. A decision is attached to the detected series of the same
-- counterparty key and cadence whose amount is closest to referenceAmount,
-- so it survives a price change. Amount in Decimal(15, 2), handled in cents.
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- CreateEnum
CREATE TYPE "SubscriptionCadence" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionDecisionStatus" AS ENUM ('CONFIRMED', 'IGNORED');

-- CreateTable
CREATE TABLE "subscription_decisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "counterpartyKey" TEXT NOT NULL,
    "cadence" "SubscriptionCadence" NOT NULL,
    "referenceAmount" DECIMAL(15,2) NOT NULL,
    "status" "SubscriptionDecisionStatus" NOT NULL,
    "budgetLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_decisions_identity_key" ON "subscription_decisions"("companyId", "counterpartyKey", "cadence", "referenceAmount");

-- CreateIndex
CREATE INDEX "subscription_decisions_budgetLineId_idx" ON "subscription_decisions"("budgetLineId");

-- AddForeignKey
ALTER TABLE "subscription_decisions" ADD CONSTRAINT "subscription_decisions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_decisions" ADD CONSTRAINT "subscription_decisions_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants of every code path
ALTER TABLE "subscription_decisions" ADD CONSTRAINT "subscription_decisions_reference_check"
  CHECK ("counterpartyKey" <> '' AND "referenceAmount" > 0);

-- Row level security: company table
ALTER TABLE "subscription_decisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "subscription_decisions" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "subscription_decisions" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "subscription_decisions" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "subscription_decisions" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
