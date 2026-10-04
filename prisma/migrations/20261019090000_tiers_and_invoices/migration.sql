-- Purchase and sales ledger: tiers (customers and suppliers), invoices
-- recorded with their lines and VAT breakdown, and the bank payments recorded
-- on them. Additive: new enums, tables, one company column with a default and
-- check constraints on the new tables; no change to existing rows, entries or
-- triggers.
--
-- 1. "tiers": one row per customer or supplier of a company. Its
--    "auxiliaryAccountNumber" is the FEC CompAuxNum (LPF art. A47 A-1) of
--    the entry lines it owns; lettering and the third-party balances group
--    lines by that number, so attaching a tiers never rewrites a posted line.
--    Its payment terms override the company's and keep the caps of Code de
--    commerce art. L441-10 (60 days, or 45 days end of month).
-- 2. "invoices", "invoice_lines", "invoice_vat_breakdowns": invoices entered
--    in Kledg or imported from Qonto, amounts stored as DECIMAL(15,2), VAT
--    rates in basis points (CGI ann. II art. 242 nonies A, I, 8° and 11°).
--    "entryId" links the draft entry created by posting (AC or VE journal);
--    deleting that draft sets it back to NULL (the invoice is a draft again).
-- 3. "invoice_payments": the line of a validated, bank-reconciled entry
--    paying one invoice; the invoice is lettered once its payments cover it.
-- 4. "companies"."servicesVatOnDebits": the option to pay VAT on services on
--    debits (CGI art. 269, 2, c); false by default (VAT on receipts).

-- CreateEnum
CREATE TYPE "TiersKind" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('MANUAL', 'QONTO');

-- CreateEnum
CREATE TYPE "InvoiceLineNature" AS ENUM ('GOODS', 'SERVICES');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "servicesVatOnDebits" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tiers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "TiersKind" NOT NULL,
    "name" TEXT NOT NULL,
    "siren" TEXT,
    "siret" TEXT,
    "vatNumber" TEXT,
    "email" TEXT,
    "addressId" TEXT,
    "auxiliaryAccountNumber" TEXT NOT NULL,
    "collectiveAccountCode" TEXT,
    "defaultAccountCode" TEXT,
    "defaultVatRateBp" INTEGER,
    "paymentTermsDays" INTEGER,
    "paymentTermsEndOfMonth" BOOLEAN,
    "qontoId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "tiersId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "typeCode" TEXT NOT NULL DEFAULT '380',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "label" TEXT,
    "sellerSiren" TEXT,
    "sellerVatNumber" TEXT,
    "buyerSiren" TEXT,
    "buyerVatNumber" TEXT,
    "totalExclTax" DECIMAL(15,2) NOT NULL,
    "totalVat" DECIMAL(15,2) NOT NULL,
    "totalInclTax" DECIMAL(15,2) NOT NULL,
    "entryId" TEXT,
    "source" "InvoiceSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "externalStatus" TEXT,
    "externalAttachmentId" TEXT,
    "attachmentFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "totalExclTax" DECIMAL(15,2) NOT NULL,
    "accountCode" TEXT,
    "nature" "InvoiceLineNature" NOT NULL DEFAULT 'SERVICES',
    "fixedAsset" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_vat_breakdowns" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "baseAmount" DECIMAL(15,2) NOT NULL,
    "vatAmount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "invoice_vat_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "entryLineId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "vatTransferEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tiers_companyId_kind_name_idx" ON "tiers"("companyId", "kind", "name");

-- CreateIndex
CREATE INDEX "tiers_addressId_idx" ON "tiers"("addressId");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_companyId_auxiliaryAccountNumber_key" ON "tiers"("companyId", "auxiliaryAccountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_companyId_kind_qontoId_key" ON "tiers"("companyId", "kind", "qontoId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_entryId_key" ON "invoices"("entryId");

-- CreateIndex
CREATE INDEX "invoices_companyId_direction_issueDate_idx" ON "invoices"("companyId", "direction", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_tiersId_idx" ON "invoices"("tiersId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_companyId_direction_tiersId_number_key" ON "invoices"("companyId", "direction", "tiersId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_companyId_source_externalId_key" ON "invoices"("companyId", "source", "externalId");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_vat_breakdowns_invoiceId_vatRateBp_key" ON "invoice_vat_breakdowns"("invoiceId", "vatRateBp");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_payments_entryLineId_key" ON "invoice_payments"("entryLineId");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_payments_vatTransferEntryId_idx" ON "invoice_payments"("vatTransferEntryId");

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tiersId_fkey" FOREIGN KEY ("tiersId") REFERENCES "tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_vat_breakdowns" ADD CONSTRAINT "invoice_vat_breakdowns_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_entryLineId_fkey" FOREIGN KEY ("entryLineId") REFERENCES "entry_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_vatTransferEntryId_fkey" FOREIGN KEY ("vatTransferEntryId") REFERENCES "accounting_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Checks: amounts and rates within range, payment terms within L441-10,
-- totals consistent (TTC = HT + TVA, credit notes carry positive amounts).
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_payment_terms_check" CHECK (
  ("paymentTermsDays" IS NULL AND "paymentTermsEndOfMonth" IS NULL)
  OR ("paymentTermsDays" IS NOT NULL AND "paymentTermsEndOfMonth" IS NOT NULL
      AND "paymentTermsDays" >= 0
      AND "paymentTermsDays" <= CASE WHEN "paymentTermsEndOfMonth" THEN 45 ELSE 60 END)
);
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_default_vat_rate_check" CHECK (
  "defaultVatRateBp" IS NULL OR ("defaultVatRateBp" >= 0 AND "defaultVatRateBp" <= 10000)
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_check" CHECK (
  "totalExclTax" >= 0 AND "totalVat" >= 0 AND "totalInclTax" = "totalExclTax" + "totalVat"
);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_type_code_check" CHECK ("typeCode" IN ('380', '381'));
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_values_check" CHECK (
  "quantity" > 0 AND "unitPrice" >= 0 AND "totalExclTax" >= 0 AND "vatRateBp" >= 0 AND "vatRateBp" <= 10000
);
ALTER TABLE "invoice_vat_breakdowns" ADD CONSTRAINT "invoice_vat_breakdowns_values_check" CHECK (
  "baseAmount" >= 0 AND "vatAmount" >= 0 AND "vatRateBp" >= 0 AND "vatRateBp" <= 10000
);
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_amount_check" CHECK ("amount" > 0);

