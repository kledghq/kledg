-- KLEDG-R3-AUTH-01: an API key that writes (drafts or full control) always
-- expires. Keys created before this version had no expiry: those that write
-- get the default lifetime, 90 days from the upgrade. Read-only keys keep
-- theirs. No schema change; idempotent (only keys without expiry change).
-- The level is the "kledg" entry of the Better Auth permissions (a JSON
-- text, lib/ai-access/access.ts apiKeyLevelOf); unreadable permissions are
-- read only (fail closed), so they are left as they are.
-- Test: lib/__tests__/security/credential-change-revocation.db.test.ts.

UPDATE "apikey"
SET "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '90 days', "updatedAt" = CURRENT_TIMESTAMP
WHERE "expiresAt" IS NULL
  -- Matched as text: a malformed value must not stop the migration.
  AND "permissions" ~ '"kledg"\s*:\s*\[[^]]*"(write|admin)"';
