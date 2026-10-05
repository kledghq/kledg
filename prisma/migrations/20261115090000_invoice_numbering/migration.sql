-- Automatic numbering of sales invoices (docs/factures-et-tiers.md,
-- Numérotation; CGI ann. II art. 242 nonies A, I, 7°, BOI-TVA-DECLA-30-20-20-10 § 70 to 100: a unique number in a
-- chronological and continuous sequence, several series allowed).
--
-- - companies.invoiceNumbering: the configuration (JSON, null: defaults,
--   automatic numbering for companies created from now on). Existing
--   companies keep typed numbers ({"mode": "MANUAL", "legacy": true}): their
--   numbering is not changed under them, Kledg invites them to configure the
--   automatic numbering;
--   companies.qontoInvoicingRefusal: why Qonto refused to create an invoice.
-- - invoices.origin: where the number comes from; existing rows keep their
--   numbers (QONTO for imported invoices, MANAGEMENT_FEES for the invoices
--   of a convention, MANUAL for the others).
-- - invoices.qontoDraft: created as a draft in Qonto (no number until it is
--   finalized there).
-- - invoices.number becomes nullable: a sales draft numbered by the series
--   has no number until it is posted, so deleting a draft leaves no gap.
-- - invoice_number_counters: the last number of each series and period,
--   updated under its row lock in the posting transaction.
--
-- Row level security (docs/rls.md): company table, the kledg_rls_* policies
-- on "companyId".

-- CreateEnum
CREATE TYPE "InvoiceOrigin" AS ENUM ('AUTO', 'MANUAL', 'RECORDED', 'QONTO', 'MANAGEMENT_FEES');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "invoiceNumbering" JSONB,
ADD COLUMN "qontoInvoicingRefusal" TEXT;

UPDATE "companies" SET "invoiceNumbering" = '{"mode": "MANUAL", "legacy": true}'::jsonb WHERE "invoiceNumbering" IS NULL;

ALTER TABLE "companies" ADD CONSTRAINT "companies_invoiceNumbering_check"
  CHECK ("invoiceNumbering" IS NULL OR jsonb_typeof("invoiceNumbering") = 'object');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "origin" "InvoiceOrigin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "numberAssignedAt" TIMESTAMP(3),
ADD COLUMN "qontoRequestedAt" TIMESTAMP(3),
ADD COLUMN "qontoDraft" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "number" DROP NOT NULL;

UPDATE "invoices" SET "origin" = 'QONTO' WHERE "source" = 'QONTO';
UPDATE "invoices" SET "origin" = 'MANAGEMENT_FEES'
  WHERE "id" IN (SELECT "salesInvoiceId" FROM "management_fee_billings" WHERE "salesInvoiceId" IS NOT NULL);

-- A number is missing only on a sales draft of the series, or while Qonto
-- has not answered; once posted, every invoice has its number.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_check"
  CHECK (
    ("number" IS NOT NULL AND char_length(btrim("number")) BETWEEN 1 AND 60)
    OR ("number" IS NULL AND "direction" = 'SALE' AND "entryId" IS NULL AND "origin" IN ('AUTO', 'QONTO'))
  );

-- CreateTable
CREATE TABLE "invoice_number_counters" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_counters_companyId_series_periodKey_key" ON "invoice_number_counters"("companyId", "series", "periodKey");

-- AddForeignKey
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_series_check"
  CHECK ("series" IN ('INVOICE', 'CREDIT_NOTE'));
ALTER TABLE "invoice_number_counters" ADD CONSTRAINT "invoice_number_counters_lastValue_check"
  CHECK ("lastValue" >= 0);

-- Row level security: company table
ALTER TABLE "invoice_number_counters" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "invoice_number_counters" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "invoice_number_counters" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "invoice_number_counters" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "invoice_number_counters" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
