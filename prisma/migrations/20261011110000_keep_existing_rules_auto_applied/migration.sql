-- Data migration: keeps the header refresh creating the entries of the
-- assignment rules that existed before "Créer automatiquement l'écriture"
-- was honoured. No schema change.
--
-- Until this version the refresh applied every matching enabled rule,
-- whatever its "autoCreate" value (the checkbox was saved but unused, and
-- unchecked by default). The refresh now applies only the rules with
-- "autoCreate" (lib/transactions/rule-matcher.ts, docs/regles-d-affectation.md),
-- so the enabled rules of that time get it, and keep working as before.
-- Rules created afterwards keep what the rule dialog chose. Disabled rules
-- are left as they are.
--
-- Idempotent: only rules created before this migration first ran are
-- concerned (its start time in _prisma_migrations; the current time when the
-- table is absent, as in the test databases), and a rule already marked is
-- not written again. A rule created later with the box unchecked is never
-- changed by a second run.
-- Test: lib/transactions/__tests__/keep-rules-auto-applied-migration.db.test.ts.

DO $$
DECLARE
  cutoff timestamptz := now();
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    SELECT COALESCE(MIN(started_at), now()) INTO cutoff
    FROM "_prisma_migrations"
    WHERE migration_name = '20261011110000_keep_existing_rules_auto_applied';
  END IF;

  UPDATE "transaction_rules"
  SET "autoCreate" = true, "updatedAt" = now()
  WHERE "enabled" = true
    AND "autoCreate" = false
    AND "createdAt" <= (cutoff AT TIME ZONE 'UTC');
END $$;
