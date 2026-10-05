-- Customer payments confirmed in simple mode, docs/categories-simples.md.
--
-- simple_mode_entries.invoiceId: the sales invoice a bank credit confirmed
-- in "Recettes à vérifier" pays. The payment is recorded on the invoice
-- (invoice_payments) by the invoices module once the entry is validated:
-- at once without accountant review, at validation otherwise. NO ACTION:
-- an invoice a payment points to is not deleted behind it (unposting it is
-- refused first, lib/invoices/post-invoice.service.ts).
--
-- Row level security (docs/rls.md): a new column of a company table,
-- covered by its existing kledg_rls_* policies.

-- AlterTable
ALTER TABLE "simple_mode_entries" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE INDEX "simple_mode_entries_invoiceId_idx" ON "simple_mode_entries"("invoiceId");

-- AddForeignKey
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- A simple mode entry comes from a category, a transaction rule, or now the
-- sales invoice a customer payment settles. The check widens: every row it
-- accepted before it still accepts.
ALTER TABLE "simple_mode_entries" DROP CONSTRAINT "simple_mode_entries_origin_check";
ALTER TABLE "simple_mode_entries" ADD CONSTRAINT "simple_mode_entries_origin_check"
  CHECK (("categoryId" IS NOT NULL OR "ruleId" IS NOT NULL OR "invoiceId" IS NOT NULL) AND "source" IN ('web', 'mcp'));
