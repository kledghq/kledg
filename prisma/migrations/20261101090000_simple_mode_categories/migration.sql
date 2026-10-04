-- Simple mode categories, docs/categories-simples.md.
--
-- A user who does not know accounting confirms a plain language category
-- for a bank transaction; the entry is created by the entry and
-- reconciliation services like any other. simple_mode_entries records where
-- an entry came from: the category, the answers to its question, the note
-- for the accountant, whether the accountant must validate it, and the
-- normalized counterparty that feeds the next suggestions. A row goes with
-- its entry (a draft deleted when the reconciliation is undone).
--
-- companies.simpleModeAccountantReview: whether simple mode entries stay
-- drafts for the accountant; null is the default, on when the company has a
-- member with the accountant role.
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "simpleModeAccountantReview" BOOLEAN;

-- CreateTable
CREATE TABLE "simple_mode_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "bankTransactionId" TEXT,
    "categoryId" TEXT,
    "ruleId" TEXT,
    "answers" JSONB,
    "note" TEXT,
    "counterpartyKey" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "learnedRuleId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simple_mode_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "simple_mode_entries_entryId_key" ON "simple_mode_entries"("entryId");

-- CreateIndex
CREATE INDEX "simple_mode_entries_companyId_counterpartyKey_idx" ON "simple_mode_entries"("companyId", "counterpartyKey");

-- CreateIndex
CREATE INDEX "simple_mode_entries_bankTransactionId_idx" ON "simple_mode_entries"("bankTransactionId");

-- AddForeignKey
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants of every code path: a row names what chose the lines, and the
-- source is one of the two entry points.
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_origin_check"
  CHECK (("categoryId" IS NOT NULL OR "ruleId" IS NOT NULL) AND "source" IN ('web', 'mcp'));

-- Row level security: company table
ALTER TABLE "simple_mode_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "simple_mode_entries" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "simple_mode_entries" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "simple_mode_entries" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "simple_mode_entries" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
