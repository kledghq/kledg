-- Company administrators invite their members (GitHub issue #13,
-- lib/rbac/company-invitations.service.ts, docs/membres-et-invitations.md).
--
-- company_invitations: one row per invitation. The emailed link carries a
-- random token; only its SHA-256 (tokenHash) is stored. An invitation is open
-- while it is neither accepted nor revoked; the service keeps at most one
-- open invitation per company and address (under an advisory lock). Accepting
-- sets acceptedAt once.
--
-- Row level security (docs/rls.md): a company table, the kledg_rls_*
-- policies on "companyId". The acceptance page looks an invitation up by its
-- token in the system context 'invitation-acceptance'.

-- CreateTable
CREATE TABLE "company_invitations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_tokenHash_key" ON "company_invitations"("tokenHash");
CREATE INDEX "company_invitations_companyId_idx" ON "company_invitations"("companyId");
CREATE INDEX "company_invitations_companyId_email_idx" ON "company_invitations"("companyId", "email");

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants of every code path: a company role only, a lowercased address,
-- a SHA-256 hex hash, never both accepted and revoked.
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_role_check"
  CHECK ("role" IN ('companyAdmin', 'accountant', 'viewer'));
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_email_check"
  CHECK ("email" = lower("email") AND length("email") BETWEEN 3 AND 320);
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_state_check"
  CHECK (NOT ("acceptedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));

-- Row level security: company table
ALTER TABLE "company_invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kledg_rls_select" ON "company_invitations" FOR SELECT USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_insert" ON "company_invitations" FOR INSERT WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_update" ON "company_invitations" FOR UPDATE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[]))) WITH CHECK (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
CREATE POLICY "kledg_rls_delete" ON "company_invitations" FOR DELETE USING (((SELECT kledg_rls_unrestricted()) OR "companyId" = ANY ((SELECT kledg_rls_company_ids())::text[])));
