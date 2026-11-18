-- Import of e-invoice files, Factur-X, CII and UBL (lib/invoices/import-e-invoice.service.ts).
-- The file is kept as received in receipt_files (LPF art. L102 B: an
-- e-invoice is kept in its original format); deleteUnreferencedReceiptFiles
-- never deletes a file an invoice refers to.

ALTER TYPE "InvoiceSource" ADD VALUE 'E_INVOICE';

ALTER TABLE "invoices" ADD COLUMN "documentFileId" TEXT;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_documentFileId_fkey" FOREIGN KEY ("documentFileId") REFERENCES "receipt_files"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE INDEX "invoices_documentFileId_idx" ON "invoices"("documentFileId");

-- An e-invoice kept as received may be an XML file (CII or UBL), besides
-- the PDF of a Factur-X invoice: the receipt file types widen to it. A
-- receipt staged by a user is still checked against images and PDF by
-- lib/receipts/file-type.ts.
ALTER TABLE "receipt_files" DROP CONSTRAINT "receipt_files_content_type_check";
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_content_type_check" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'application/pdf', 'application/xml'));
