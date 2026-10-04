-- Multi-provider bank connections: Qonto and Revolut Business direct APIs,
-- Ponto for other banks, manual accounts fed by statement files.
-- Additive only. A company may now hold one connection per provider, so the
-- unique index on bank_connections.companyId becomes (companyId, provider)
-- (dropping an index loses no data).

-- AlterEnum
ALTER TYPE "BankingProvider" ADD VALUE 'REVOLUT';
ALTER TYPE "BankingProvider" ADD VALUE 'PONTO';
ALTER TYPE "BankingProvider" ADD VALUE 'MANUAL';

-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'PONTO';

-- DropIndex
DROP INDEX "bank_connections_companyId_key";

-- AlterTable
ALTER TABLE "bank_connections" ADD COLUMN     "consentExpiresAt" TIMESTAMP(3),
ADD COLUMN     "integrationId" TEXT,
ADD COLUMN     "lastManualSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncError" TEXT,
ALTER COLUMN "login" SET DEFAULT '',
ALTER COLUMN "secretKeyEncrypted" SET DEFAULT '';

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "consentExpiresAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "ledgerAccountCode" TEXT,
ADD COLUMN     "supersededById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_integrationId_key" ON "bank_connections"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_companyId_provider_key" ON "bank_connections"("companyId", "provider");

-- CreateIndex
CREATE INDEX "bank_accounts_iban_idx" ON "bank_accounts"("iban");

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link existing Qonto connections to the integration holding their credentials
UPDATE "bank_connections" AS bc
SET "integrationId" = (
  SELECT i."id" FROM "integrations" AS i
  WHERE i."companyId" = bc."companyId" AND i."provider" = 'QONTO' AND i."type" = 'BANKING'
  ORDER BY i."createdAt" DESC
  LIMIT 1
)
WHERE bc."provider" = 'QONTO' AND bc."integrationId" IS NULL;
