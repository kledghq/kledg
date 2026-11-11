-- Full control of an AI assistant now needs the user's password, like a
-- full control API key (KLEDG-R3-AUTH-01): an OAuth token's kledg:admin
-- scope counts only once the grant records that confirmation. Grants that
-- exist today keep working: they are marked confirmed at their last change.
ALTER TABLE "ai_access_grants" ADD COLUMN "fullControlConfirmedAt" TIMESTAMP(3);
UPDATE "ai_access_grants" SET "fullControlConfirmedAt" = "updatedAt";
