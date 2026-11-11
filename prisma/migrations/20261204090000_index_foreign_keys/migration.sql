-- Index every foreign key column that had none. Deleting a parent row
-- (an account with ON DELETE SET NULL children, a company and its cascades,
-- a user) scanned the whole referencing table once per deleted row: on the
-- demo, deleting one sandbox took over a minute (kledghq/kledg#27).

-- CreateIndex
CREATE INDEX "accounts_parentId_idx" ON "accounts"("parentId");

-- CreateIndex
CREATE INDEX "accounting_entries_journalId_idx" ON "accounting_entries"("journalId");

-- CreateIndex
CREATE INDEX "bank_connections_selectedAccountId_idx" ON "bank_connections"("selectedAccountId");

-- CreateIndex
CREATE INDEX "bank_accounts_supersededById_idx" ON "bank_accounts"("supersededById");

-- CreateIndex
CREATE INDEX "fixed_assets_assetAccountId_idx" ON "fixed_assets"("assetAccountId");

-- CreateIndex
CREATE INDEX "fixed_assets_depreciationAccountId_idx" ON "fixed_assets"("depreciationAccountId");

-- CreateIndex
CREATE INDEX "fixed_assets_expenseAccountId_idx" ON "fixed_assets"("expenseAccountId");

-- CreateIndex
CREATE INDEX "invitation_inviterId_idx" ON "invitation"("inviterId");

-- CreateIndex
CREATE INDEX "ai_access_grants_clientId_idx" ON "ai_access_grants"("clientId");

-- CreateIndex
CREATE INDEX "staged_receipts_bankTransactionId_idx" ON "staged_receipts"("bankTransactionId");

-- CreateIndex
CREATE INDEX "staged_receipts_attachmentId_idx" ON "staged_receipts"("attachmentId");

-- CreateIndex
CREATE INDEX "staged_receipts_expenseReportId_idx" ON "staged_receipts"("expenseReportId");

