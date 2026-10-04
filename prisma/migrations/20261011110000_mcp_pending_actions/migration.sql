-- Human approval of high-impact MCP full control actions
-- (lib/mcp/full-control/pending-actions.ts). Additive: one new table.
--
-- A high-impact tool called by an assistant records a pending action bound
-- to the user, the connection, the tool, the company and the arguments,
-- with its preview, and returns the URL of the approval page. The user
-- approves or refuses it in Kledg (signed in, password typed again); the
-- assistant can only execute an approved action, once, before it expires.
-- The confirmation tokens of mcp_confirmations, which the assistant itself
-- received and could replay, are no longer issued (the table is left for a
-- later contract migration).
-- Deleting a user or a company deletes its pending actions.

-- CreateTable
CREATE TABLE "mcp_pending_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "callerName" TEXT,
    "tool" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "argsHash" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_pending_actions_userId_status_idx" ON "mcp_pending_actions"("userId", "status");

-- CreateIndex
CREATE INDEX "mcp_pending_actions_companyId_idx" ON "mcp_pending_actions"("companyId");

-- CreateIndex
CREATE INDEX "mcp_pending_actions_expiresAt_idx" ON "mcp_pending_actions"("expiresAt");

-- AddForeignKey
ALTER TABLE "mcp_pending_actions" ADD CONSTRAINT "mcp_pending_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_pending_actions" ADD CONSTRAINT "mcp_pending_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
