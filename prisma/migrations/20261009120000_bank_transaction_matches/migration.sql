-- Lines read from a bank API that duplicate a transaction the account
-- already holds from another source (a statement file, or the Ponto account
-- a direct connection replaced for the same IBAN): the sync records the
-- match instead of inserting the line (lib/integrations/sync.ts). Additive.

-- CreateTable
CREATE TABLE "bank_transaction_matches" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transaction_matches_pkey" PRIMARY KEY ("id")
);

-- One existing transaction stands for at most one provider line (count aware matching)
-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_matches_bankTransactionId_key" ON "bank_transaction_matches"("bankTransactionId");

-- A provider line is matched once per synced account (retried syncs)
-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_matches_bankAccountId_externalTransactionI_key" ON "bank_transaction_matches"("bankAccountId", "externalTransactionId");

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction_matches" ADD CONSTRAINT "bank_transaction_matches_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
