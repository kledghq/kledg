-- Receipt files in object storage (lib/storage, docs/configuration.md,
-- docs/justificatifs-photo.md).
--
-- receipt_files keeps one row per content in a company (SHA-256, the
-- deduplication stays here) but its bytes may now live outside the
-- database: "storageDriver" says where (postgres: in "content", as before;
-- blob: a private Vercel Blob store; s3: an S3 compatible bucket; fs: a
-- directory of the server) and "storageKey" is the object's key,
-- receipts/<companyId>/<random>. Existing rows are postgres rows; they move
-- with `pnpm receipts:migrate-storage`, which verifies the SHA-256 before
-- clearing "content".
--
-- Additive: two columns, "content" becomes nullable, invariants below.

-- AlterTable
ALTER TABLE "receipt_files" ADD COLUMN "storageDriver" TEXT NOT NULL DEFAULT 'postgres';
ALTER TABLE "receipt_files" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "receipt_files" ALTER COLUMN "content" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "receipt_files_storageKey_key" ON "receipt_files"("storageKey");

-- Invariants of every code path: the bytes are in exactly one place, and an
-- object key always sits under its own company (a row never points to
-- another company's object).
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_storage_driver_check" CHECK ("storageDriver" IN ('postgres', 'blob', 's3', 'fs'));
ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_storage_check" CHECK (
  ("storageDriver" = 'postgres' AND "content" IS NOT NULL AND "storageKey" IS NULL)
  OR ("storageDriver" <> 'postgres' AND "content" IS NULL AND "storageKey" IS NOT NULL
      AND starts_with("storageKey", 'receipts/' || "companyId" || '/'))
);
