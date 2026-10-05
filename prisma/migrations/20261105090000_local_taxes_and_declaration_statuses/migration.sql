-- Local taxes (CFE, CVAE) and the declarations tracker, docs/impots-locaux.md
-- and docs/echeances.md (lib/local-taxes, lib/declarations).
--
-- local_taxes: one row per company and calendar year. The CFE avis
-- d'imposition as the user reads it on impots.gouv.fr (Kledg cannot compute
-- the rental value of CGI art. 1467 nor the commune rate) and the manual
-- adjustments of the CVAE value added (CGI art. 1586 sexies).
--
-- declaration_statuses: one row per company and deadline of the calendar
-- (deadline ids of lib/deadlines/engine.ts): filed and/or paid with the
-- date, the amount, a receipt already in Kledg or its reference, a note, or
-- not due. Kledg never files nor pays.
--
-- Row level security (docs/rls.md): two company tables, the kledg_rls_*
-- policies on "companyId".

-- CreateTable
CREATE TABLE "local_taxes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "cfeTotal" DECIMAL(15,2),
    "cfeAcompte" DECIMAL(15,2),
    "cfeNoticeOn" TIMESTAMP(3),
    "cfeNote" TEXT,
    "cvaeAdjustments" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaration_statuses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "filedOn" TIMESTAMP(3),
    "paidOn" TIMESTAMP(3),
    "amount" DECIMAL(15,2),
    "notDue" BOOLEAN NOT NULL DEFAULT false,
    "attachmentId" TEXT,
    "attachmentReference" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "declaration_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_taxes_companyId_year_key" ON "local_taxes"("companyId", "year");

-- CreateIndex
CREATE INDEX "local_taxes_companyId_idx" ON "local_taxes"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "declaration_statuses_companyId_deadlineId_key" ON "declaration_statuses"("companyId", "deadlineId");

-- CreateIndex
CREATE INDEX "declaration_statuses_companyId_idx" ON "declaration_statuses"("companyId");

-- CreateIndex
CREATE INDEX "declaration_statuses_attachmentId_idx" ON "declaration_statuses"("attachmentId");

-- AddForeignKey
ALTER TABLE "local_taxes" ADD CONSTRAINT "local_taxes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaration_statuses" ADD CONSTRAINT "declaration_statuses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the service checks the attachment belongs to the row's company.
ALTER TABLE "declaration_statuses" ADD CONSTRAINT "declaration_statuses_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants of every code path.
-- CFE: amounts never negative, the acompte part of the total, the avis
-- details only with its total; years of the CET (2010 on); JSON list.
ALTER TABLE "local_taxes" ADD CONSTRAINT "local_taxes_year_check" CHECK ("year" BETWEEN 2010 AND 2100);
ALTER TABLE "local_taxes" ADD CONSTRAINT "local_taxes_cfe_check"
  CHECK (
    ("cfeTotal" IS NULL AND "cfeAcompte" IS NULL AND "cfeNoticeOn" IS NULL)
    OR ("cfeTotal" IS NOT NULL AND "cfeTotal" >= 0 AND ("cfeAcompte" IS NULL OR ("cfeAcompte" >= 0 AND "cfeAcompte" <= "cfeTotal")))
  );
ALTER TABLE "local_taxes" ADD CONSTRAINT "local_taxes_adjustments_check" CHECK (jsonb_typeof("cvaeAdjustments") = 'array');

-- Tracker: a deadline id of the engine, an amount never negative, a row
-- that says something, and a deadline not due is neither filed nor paid.
ALTER TABLE "declaration_statuses" ADD CONSTRAINT "declaration_statuses_deadline_check"
  CHECK ("deadlineId" ~ '^[a-z0-9-]+:[0-9A-Za-z:-]+$' AND length("deadlineId") <= 100);
ALTER TABLE "declaration_statuses" ADD CONSTRAINT "declaration_statuses_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "declaration_statuses" ADD CONSTRAINT "declaration_statuses_not_due_check"
  CHECK (NOT "notDue" OR ("filedOn" IS NULL AND "paidOn" IS NULL));
ALTER TABLE "declaration_statuses" ADD CONSTRAINT "declaration_statuses_content_check"
  CHECK ("filedOn" IS NOT NULL OR "paidOn" IS NOT NULL OR "notDue" OR "note" IS NOT NULL OR "attachmentId" IS NOT NULL OR "attachmentReference" IS NOT NULL);

-- Row level security: company tables
ALTER TABLE "local_taxes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "local_taxes" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "local_taxes" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "local_taxes" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "local_taxes" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "declaration_statuses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "declaration_statuses" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "declaration_statuses" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "declaration_statuses" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "declaration_statuses" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
