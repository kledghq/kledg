-- Data migration: AI connections get an explicit access, so the code can
-- fail closed. No schema change; idempotent.
--
-- Until now a connection (OAuth assistant or API key) without a row in
-- ai_access_grants reached every company of its user, and an API key
-- without a "kledg" permission had the write level (read and draft
-- entries). From this version a missing grant means no company and a
-- missing level means read only (lib/ai-access). So that nothing changes for
-- existing connections, they get what they had, written down:
--   1. each OAuth consent without a grant: an "every company" grant;
--   2. each API key without a grant: an "every company" grant;
--   3. each API key without a kledg level: {"kledg": ["read", "write"]}
--      (unreadable permissions were treated as none, so they get it too).
-- Test: lib/ai-access/__tests__/explicit-access-migration.db.test.ts.

INSERT INTO "ai_access_grants" ("id", "userId", "clientId", "apiKeyId", "allCompanies", "createdAt", "updatedAt")
SELECT DISTINCT ON (c."userId", c."clientId")
       'grant_' || md5('oauth:' || c."userId" || ':' || c."clientId"), c."userId", c."clientId", NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "oauthConsent" c
WHERE c."userId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "user" u WHERE u."id" = c."userId")
  AND EXISTS (SELECT 1 FROM "oauthClient" o WHERE o."clientId" = c."clientId")
  AND NOT EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."userId" = c."userId" AND g."clientId" = c."clientId")
ON CONFLICT DO NOTHING;

INSERT INTO "ai_access_grants" ("id", "userId", "clientId", "apiKeyId", "allCompanies", "createdAt", "updatedAt")
SELECT 'grant_' || md5('apikey:' || k."id"), k."referenceId", NULL, k."id", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "apikey" k
WHERE EXISTS (SELECT 1 FROM "user" u WHERE u."id" = k."referenceId")
  AND NOT EXISTS (SELECT 1 FROM "ai_access_grants" g WHERE g."apiKeyId" = k."id")
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  r record;
  parsed jsonb;
BEGIN
  FOR r IN SELECT "id", "permissions" FROM "apikey" LOOP
    BEGIN
      parsed := COALESCE(NULLIF(btrim(r."permissions"), '')::jsonb, '{}'::jsonb);
    EXCEPTION WHEN others THEN
      parsed := '{}'::jsonb;
    END;
    IF jsonb_typeof(parsed) <> 'object' THEN
      parsed := '{}'::jsonb;
    END IF;
    IF NOT (parsed ? 'kledg') OR jsonb_typeof(parsed -> 'kledg') <> 'array' THEN
      UPDATE "apikey" SET "permissions" = (parsed || '{"kledg": ["read", "write"]}'::jsonb)::text WHERE "id" = r."id";
    END IF;
  END LOOP;
END
$$;
