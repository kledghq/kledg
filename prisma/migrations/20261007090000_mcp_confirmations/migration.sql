-- Confirmation tokens of full control MCP tools (lib/mcp/full-control).
-- Additive: one new table. A tool called without confirm stores the hash of
-- a token bound to the user, the connection, the tool, the company and the
-- arguments; executing the action consumes it once, within 10 minutes.
-- Deleting a user or a company deletes its tokens.

-- CreateTable
CREATE TABLE "mcp_confirmations" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "argsHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_confirmations_tokenHash_key" ON "mcp_confirmations"("tokenHash");

-- CreateIndex
CREATE INDEX "mcp_confirmations_userId_idx" ON "mcp_confirmations"("userId");

-- CreateIndex
CREATE INDEX "mcp_confirmations_companyId_idx" ON "mcp_confirmations"("companyId");

-- CreateIndex
CREATE INDEX "mcp_confirmations_expiresAt_idx" ON "mcp_confirmations"("expiresAt");

-- AddForeignKey
ALTER TABLE "mcp_confirmations" ADD CONSTRAINT "mcp_confirmations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_confirmations" ADD CONSTRAINT "mcp_confirmations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
