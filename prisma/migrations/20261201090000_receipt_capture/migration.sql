-- Receipts photographed in an assistant or dropped on the Justificatifs page
-- (lib/receipts, docs/justificatifs-photo.md).
--
-- receipt_files: the bytes of a receipt Kledg keeps itself, one row per
-- content in a company (SHA-256). JPEG, PNG or PDF of 5 MB at most, checked
-- by magic bytes before the insert (lib/receipts/file-type.ts) and bounded
-- here. Kept while a staged receipt or an attachment refers to it: an
-- attachment of a bank without receipt API, or of an expense line, points to
-- its file with attachments.receiptFileId.
--
-- staged_receipts: a receipt sent to Kledg before it is filed. status
-- staged (waiting), attached (to a bank transaction), expense (a line of an
-- expense report) or discarded. An unclaimed one expires 30 days after it
-- was staged and is deleted with its file (lib/receipts/stage-receipt.service.ts).
--
-- Row level security (docs/rls.md): two company tables, the kledg_rls_*
-- policies on "companyId".

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "receiptFileId" TEXT;

-- CreateTable
CREATE TABLE "receipt_files" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staged_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileId" TEXT,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'staged',
    "uploadedById" TEXT,
    "amount" DECIMAL(15,2),
    "currency" TEXT,
    "receiptDate" TIMESTAMP(3),
    "merchantName" TEXT,
    "vatLines" JSONB,
    "paymentHint" TEXT,
    "bankTransactionId" TEXT,
    "attachmentId" TEXT,
    "expenseReportId" TEXT,
    "expenseLineId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staged_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_files_companyId_sha256_key" ON "receipt_files"("companyId", "sha256");

-- CreateIndex
CREATE INDEX "staged_receipts_companyId_status_idx" ON "staged_receipts"("companyId", "status");

-- CreateIndex
CREATE INDEX "staged_receipts_uploadedById_idx" ON "staged_receipts"("uploadedById");

-- CreateIndex
CREATE INDEX "staged_receipts_expiresAt_idx" ON "staged_receipts"("expiresAt");

-- CreateIndex
CREATE INDEX "staged_receipts_fileId_idx" ON "staged_receipts"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "staged_receipts_companyId_sha256_key" ON "staged_receipts"("companyId", "sha256");

-- CreateIndex
CREATE INDEX "attachments_receiptFileId_idx" ON "attachments"("receiptFileId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "receipt_files"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "receipt_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_expenseReportId_fkey" FOREIGN KEY ("expenseReportId") REFERENCES "expense_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants of every code path.
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_content_type_check" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'application/pdf'));
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_size_check" CHECK ("size" > 0 AND "size" <= 5242880 AND octet_length("content") = "size");
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_status_check" CHECK ("status" IN ('staged', 'attached', 'expense', 'discarded'));
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_source_check" CHECK ("source" IN ('view', 'file_param', 'base64', 'app'));
ALTER TABLE "staged_receipts" ADD CONSTRAINT "staged_receipts_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0);

-- Row level security: company tables
ALTER TABLE "receipt_files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "receipt_files" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "receipt_files" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "receipt_files" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "receipt_files" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));

ALTER TABLE "staged_receipts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "staged_receipts" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "staged_receipts" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "staged_receipts" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "staged_receipts" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
