-- Tokens of AI assistants follow their consent, and the full control scope
-- (kledg:admin) can be requested (lib/mcp/auth.ts, docs/mcp.md). Additive:
-- two trigger functions and two triggers on "oauthConsent", an index, and
-- two updates that only append a scope; the grant cleanup trigger of
-- 20261005090000 is unchanged.
--
-- Done in the database so every code path is covered: revocation from the
-- "Connexions IA" page (/oauth2/delete-consent), a new consent with fewer
-- scopes (/oauth2/consent) or a lowered access level (/oauth2/update-consent).
--
-- - Deleting the last consent of a user for an OAuth client deletes that
--   user's refresh tokens and stored (opaque) access tokens for the client:
--   the assistant can no longer obtain new access tokens. JWT access tokens
--   are not stored; /api/mcp refuses them once the consent is gone.
-- - Narrowing the scopes of a consent narrows the scopes of the user's
--   refresh and stored access tokens for the client to the consented ones,
--   so a refresh never issues a scope the user withdrew.

CREATE OR REPLACE FUNCTION kledg_revoke_tokens_on_consent_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."userId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "oauthConsent"
    WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId" AND "id" <> OLD."id"
  ) THEN
    DELETE FROM "oauthAccessToken" WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId";
    DELETE FROM "oauthRefreshToken" WHERE "userId" = OLD."userId" AND "clientId" = OLD."clientId";
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER kledg_revoke_tokens_on_consent_delete
  AFTER DELETE ON "oauthConsent"
  FOR EACH ROW EXECUTE FUNCTION kledg_revoke_tokens_on_consent_delete();

CREATE OR REPLACE FUNCTION kledg_narrow_tokens_on_consent_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" IS NOT NULL THEN
    UPDATE "oauthRefreshToken"
      SET "scopes" = ARRAY(SELECT s FROM unnest("scopes") AS s WHERE s = ANY (NEW."scopes"))
      WHERE "userId" = NEW."userId" AND "clientId" = NEW."clientId" AND NOT ("scopes" <@ NEW."scopes");
    UPDATE "oauthAccessToken"
      SET "scopes" = ARRAY(SELECT s FROM unnest("scopes") AS s WHERE s = ANY (NEW."scopes"))
      WHERE "userId" = NEW."userId" AND "clientId" = NEW."clientId" AND NOT ("scopes" <@ NEW."scopes");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kledg_narrow_tokens_on_consent_update
  AFTER UPDATE OF "scopes" ON "oauthConsent"
  FOR EACH ROW
  WHEN (OLD."scopes" IS DISTINCT FROM NEW."scopes")
  EXECUTE FUNCTION kledg_narrow_tokens_on_consent_update();

-- /api/mcp looks up the consent of (user, client) on every call.
CREATE INDEX "oauthConsent_userId_clientId_idx" ON "oauthConsent"("userId", "clientId");

-- Full control (kledg:admin, lib/ai-access/access.ts). Better Auth seeds the
-- MCP resource only when it is missing ("insertOnly"), and dynamically
-- registered clients keep the scope list they registered with: both may now
-- ask for kledg:admin, otherwise their next authorization would fail with
-- invalid_scope. Asking is not granting: the user chooses the level on the
-- consent page, where full control is never preselected.
UPDATE "oauthResource"
  SET "allowedScopes" = array_append("allowedScopes", 'kledg:admin')
  WHERE 'kledg:write' = ANY ("allowedScopes") AND NOT ('kledg:admin' = ANY ("allowedScopes"));

UPDATE "oauthClient"
  SET "scopes" = array_append("scopes", 'kledg:admin')
  WHERE 'kledg:write' = ANY ("scopes") AND NOT ('kledg:admin' = ANY ("scopes"));
