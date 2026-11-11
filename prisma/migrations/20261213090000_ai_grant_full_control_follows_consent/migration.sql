-- The password confirmation of an assistant's full control
-- (ai_access_grants."fullControlConfirmedAt", migration 20261208090000)
-- follows its consent: once the consent of the user for the OAuth client no
-- longer grants kledg:admin, the confirmation is cleared, so getting full
-- control back takes the password again (lib/mcp/auth.ts reads it on every
-- call). Additive: one trigger function, two triggers on "oauthConsent" and
-- one update that only clears a timestamp.
--
-- Done in the database so every code path is covered: a lowered access
-- level from the "Connexions IA" page (/oauth2/update-consent) and a new
-- consent with fewer scopes (/oauth2/consent), whatever the row level
-- security context of the request (SECURITY DEFINER, like the other consent
-- triggers, lib/rls/tables.ts). The deletion of the last
-- consent already deletes the grant (20261005090000).

CREATE OR REPLACE FUNCTION kledg_clear_full_control_on_consent_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW."userId" IS NOT NULL AND NOT ('kledg:admin' = ANY (NEW."scopes")) THEN
    UPDATE "ai_access_grants"
      SET "fullControlConfirmedAt" = NULL
      WHERE "userId" = NEW."userId" AND "clientId" = NEW."clientId" AND "fullControlConfirmedAt" IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kledg_clear_full_control_on_consent_insert
  AFTER INSERT ON "oauthConsent"
  FOR EACH ROW EXECUTE FUNCTION kledg_clear_full_control_on_consent_change();

CREATE TRIGGER kledg_clear_full_control_on_consent_update
  AFTER UPDATE OF "scopes" ON "oauthConsent"
  FOR EACH ROW
  WHEN (OLD."scopes" IS DISTINCT FROM NEW."scopes")
  EXECUTE FUNCTION kledg_clear_full_control_on_consent_change();

-- 20261208090000 marked every existing grant confirmed. A grant whose
-- assistant has no consent with kledg:admin today was not given full
-- control: its confirmation is cleared.
UPDATE "ai_access_grants" g
  SET "fullControlConfirmedAt" = NULL
  WHERE g."clientId" IS NOT NULL
    AND g."fullControlConfirmedAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "oauthConsent" c
      WHERE c."userId" = g."userId" AND c."clientId" = g."clientId" AND 'kledg:admin' = ANY (c."scopes")
    );
