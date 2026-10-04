-- Company grants of AI assistants and API keys (lib/ai-access): which
-- companies an OAuth client or an API key may reach on behalf of a user.
-- Additive: two new tables, a check constraint and a trigger; no backfill
-- (no grant means every company of the user, as before).
--
-- Cleanup for every code path:
-- - deleting an API key, an OAuth client, a user or a company cascades;
-- - deleting the last consent of a user for an OAuth client (revocation
--   from the "Connexions IA" page, /oauth2/delete-consent) deletes the
--   grant of that user for that client (trigger below).

-- CreateTable
CREATE TABLE "ai_access_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "apiKeyId" TEXT,
    "allCompanies" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_access_grant_companies" (
    "grantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "ai_access_grant_companies_pkey" PRIMARY KEY ("grantId","companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_access_grants_apiKeyId_key" ON "ai_access_grants"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_access_grants_userId_clientId_key" ON "ai_access_grants"("userId", "clientId");

-- CreateIndex
CREATE INDEX "ai_access_grant_companies_companyId_idx" ON "ai_access_grant_companies"("companyId");

-- AddForeignKey
ALTER TABLE "ai_access_grants" ADD CONSTRAINT "ai_access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_grants" ADD CONSTRAINT "ai_access_grants_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_grants" ADD CONSTRAINT "ai_access_grants_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "apikey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_grant_companies" ADD CONSTRAINT "ai_access_grant_companies_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "ai_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_grant_companies" ADD CONSTRAINT "ai_access_grant_companies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A grant is either for an OAuth client or for an API key.
ALTER TABLE "ai_access_grants" ADD CONSTRAINT "ai_access_grants_one_target_check"
  CHECK (("clientId" IS NULL) <> ("apiKeyId" IS NULL));

CREATE OR REPLACE FUNCTION kledg_delete_grant_on_consent_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."userId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "oauthConsent"
    WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId" AND "id" <> OLD."id"
  ) THEN
    DELETE FROM "ai_access_grants" WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId";
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER kledg_delete_grant_on_consent_delete
  AFTER DELETE ON "oauthConsent"
  FOR EACH ROW EXECUTE FUNCTION kledg_delete_grant_on_consent_delete();
