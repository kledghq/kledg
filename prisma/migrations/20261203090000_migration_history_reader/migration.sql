-- Read access to the migration history for the application role, without
-- any right on the table (docs/rls.md#exempt-tables).
--
-- With KLEDG_RLS=enforce the application connects as a restricted role
-- (lib/rls/app-role.ts) that has no privilege on "_prisma_migrations": the
-- table belongs to the migration tool and the application must never write
-- it. The update history (lib/updates/history.ts, recorded at every server
-- start) and the "Mises à jour" page (lib/updates/overview.ts) read the
-- applied migrations, so they failed with "permission denied for table
-- _prisma_migrations" on such instances.
--
-- kledg_applied_migrations() returns the name and end time of the
-- migrations finished and not rolled back, nothing else (no checksum, no
-- logs). SECURITY DEFINER: it runs as its owner, the role that runs the
-- migrations and owns the table, with a pinned search_path like every
-- definer function (migration 20261029090000_definer_function_hardening).
-- EXECUTE stays with PUBLIC (the default of a new function), so the
-- application role of an existing instance can call it as soon as this
-- migration is applied, without running `pnpm db:rls-role` again; the role
-- still has no SELECT, INSERT, UPDATE or DELETE on the table.
--
-- PL/pgSQL rather than SQL: the body is resolved at call time, so the
-- function is created even where "_prisma_migrations" does not exist yet
-- (test databases built from the migration files).
-- Tests: lib/updates/__tests__/history.db.test.ts (KLEDG_RLS=enforce too),
-- lib/rls/__tests__/policy-coverage.db.test.ts.

CREATE OR REPLACE FUNCTION kledg_applied_migrations()
RETURNS TABLE (migration_name TEXT, finished_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT m.migration_name::TEXT, m.finished_at
    FROM "_prisma_migrations" m
    WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL;
END
$$;
